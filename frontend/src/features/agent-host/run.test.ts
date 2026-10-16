import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { runEventSchema, streamHostRun, type RunEvent } from './run-transport'
import { cancelHostRun, reconcileHostRun, reconcileResponseSchema, stopResponseSchema } from './api'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { runControlKey, useHostRun } from './use-host-run'
import { ToolActivity } from './tool-activity'

const sessionId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const envelope = (sequence: number, event: unknown) => ({ session_id: sessionId, run_id: runId, event_id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, sequence, created_at: '2026-10-15T00:00:00Z', event })
const started = envelope(1, { kind: 'run.started', target_id: 'primary' })
const completed = envelope(3, { kind: 'run.completed', output_text: 'Hello 世界', usage: { input_tokens: 1, output_tokens: 2 } })
const frame = (value: ReturnType<typeof envelope>, name?: string, eventId?: string) => `id: ${eventId ?? value.event_id}\r\nevent: ${name ?? (value.event as { kind: string }).kind}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`
function response(text: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize)); controller.close() } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Tool activity projection', () => {
  const invocationId = '00000000-0000-4000-8000-000000000003'
  const tool = { tool_invocation_id: invocationId, tool_name: 'inspect' }
  const result = { content: [{ type: 'text', text: '<img src=x>' }], is_error: true, metadata: {} }
  const event = (sequence: number, payload: unknown) => runEventSchema.parse(envelope(sequence, payload))

  it('groups invocation progress, retains arguments and distinguishes a tool error from failed execution', () => {
    const events = [event(1, { kind: 'tool.started', ...tool, arguments: { value: 42 } }), event(2, { kind: 'tool.completed', ...tool, result }), event(3, { kind: 'widget.failed', ...tool, application_resource_uri: 'ui://inspect', tool_result: result, error_message: 'App unavailable.' })]
    const view = render(createElement(ToolActivity, { events, open: true }))
    expect(screen.getByRole('list', { name: 'Tool activity' }).querySelectorAll('li')).toHaveLength(1)
    expect(screen.getByText(/Tool error/)).toBeDefined()
    expect(screen.getByText(/"value": 42/)).toBeDefined()
    expect(screen.getByText('App unavailable: App unavailable.')).toBeDefined()
    expect(document.querySelectorAll('img')).toHaveLength(0)
    view.rerender(createElement(ToolActivity, { events: [...events, event(4, { kind: 'tool.failed', ...tool, error_code: 'transport', error_message: 'Tool invocation failed.', result })], open: false }))
    expect(screen.getByText(/Failed/)).toBeDefined()
    expect(screen.getByText('Tool invocation failed. (transport)')).toBeDefined()
  })

  it('preserves independent invocations and never marks a started-only tool as completed', () => {
    const events = [event(1, { kind: 'tool.started', ...tool, arguments: {} }), event(2, { kind: 'tool.completed', ...tool, tool_invocation_id: sessionId, result: { ...result, is_error: false } })]
    render(createElement(ToolActivity, { events, open: false }))
    expect(screen.getByRole('list', { name: 'Tool activity' }).querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText('Outcome unknown')).toBeDefined()
    expect(screen.getByText('Completed')).toBeDefined()
  })
})

describe('Delivered App turns', () => {
  const widget = { widget_id: '00000000-0000-4000-8000-000000000004', tool_invocation_id: '00000000-0000-4000-8000-000000000003', tool_name: 'inspect', application_resource_uri: 'ui://inspect/result', resource_metadata: {}, resource_contents: [{ uri: 'ui://inspect/result', mime_type: 'text/html;profile=mcp-app', text: '<p>Result</p>' }], tool_result: { content: [{ type: 'text', text: 'Result' }], is_error: false, metadata: {} } }
  const delivered = [started, envelope(2, { kind: 'tool.started', tool_invocation_id: widget.tool_invocation_id, tool_name: widget.tool_name, arguments: { value: 42 } }), envelope(3, { kind: 'widget.created', widget }), envelope(4, completed.event)]
  const nextRunId = '00000000-0000-4000-8000-000000000006'

  it('retains only delivered widgets and their tool input through a new streaming and unknown Run', async () => {
    let finish = () => {}
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(frame({ ...started, run_id: nextRunId }))); finish = () => controller.close() } })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(delivered.map((event) => frame(event)).join(''))).mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useHostRun())
    await act(async () => { await result.current.start(sessionId, 'Inspect first') })
    const retained = result.current.appTurns[sessionId]
    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({ sessionId, runId, input: 'Inspect first' })
    expect(retained[0].events.map(({ event }) => event.kind)).toEqual(['tool.started', 'widget.created'])
    act(() => { void result.current.start(sessionId, 'New input only') })
    await waitFor(() => expect(result.current.runs[sessionId].phase).toBe('streaming'))
    expect(result.current.appTurns[sessionId]).toBe(retained)
    await act(async () => { finish() })
    await waitFor(() => expect(result.current.pending?.phase).toBe('unknown'))
    expect(result.current.appTurns[sessionId]).toBe(retained)
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([{ input_text: 'Inspect first' }, { input_text: 'New input only' }])
  })

  it('updates one turn for multiple widgets and excludes unrelated tool inputs', async () => {
    let emit = (_text: string) => {}
    const unrelated = envelope(2, { kind: 'tool.started', tool_invocation_id: '00000000-0000-4000-8000-000000000009', tool_name: 'plain', arguments: { unrelated: true } })
    const stream = new ReadableStream<Uint8Array>({ start(controller) { emit = (text) => controller.enqueue(new TextEncoder().encode(text)); emit([started, unrelated, envelope(3, delivered[1].event), envelope(4, delivered[2].event)].map((event) => frame(event)).join('')) } })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } })))
    const { result } = renderHook(() => useHostRun())
    act(() => { void result.current.start(sessionId, 'Two widgets') })
    await waitFor(() => expect(result.current.appTurns[sessionId]).toHaveLength(1))
    const firstWidget = result.current.appTurns[sessionId][0].events.find(({ event }) => event.kind === 'widget.created')
    const secondWidget = { ...widget, widget_id: nextRunId, tool_invocation_id: '00000000-0000-4000-8000-000000000007' }
    await act(async () => { emit([envelope(5, { kind: 'tool.started', tool_invocation_id: secondWidget.tool_invocation_id, tool_name: widget.tool_name, arguments: { value: 84 } }), envelope(6, { kind: 'widget.created', widget: secondWidget }), envelope(7, completed.event)].map((event) => frame(event)).join('')) })
    await waitFor(() => expect(result.current.runs[sessionId].phase).toBe('completed'))
    expect(result.current.appTurns[sessionId]).toHaveLength(1)
    const events = result.current.appTurns[sessionId][0].events
    expect(events.map((event) => event.sequence)).toEqual([3, 4, 5, 6])
    expect(events.find(({ event }) => event.kind === 'widget.created')).toBe(firstWidget)
    expect(events.filter(({ event }) => event.kind === 'widget.created')).toHaveLength(2)
  })

  it('keeps distinct App turns under the owning Session without retaining plain Runs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(delivered.map((event) => frame(event)).join('')))
      .mockResolvedValueOnce(response(delivered.map((event) => frame({ ...event, run_id: nextRunId })).join('')))
      .mockResolvedValueOnce(response([started, { ...completed, sequence: 2 }].map((event) => frame({ ...event, session_id: runId, run_id: nextRunId })).join('')))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useHostRun())
    await act(async () => { await result.current.start(sessionId, 'First App'); await result.current.start(sessionId, 'Second App'); await result.current.start(runId, 'Other Session, no App') })
    expect(result.current.appTurns[sessionId].map((turn) => ({ runId: turn.runId, input: turn.input }))).toEqual([{ runId, input: 'First App' }, { runId: nextRunId, input: 'Second App' }])
    expect(result.current.appTurns[runId]).toBeUndefined()
    expect(result.current.runs[sessionId].runId).toBe(nextRunId)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('Run control state', () => {
  const identity = { session_id: sessionId, run_id: runId }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('keeps a stopped Run open and blocked until a verified terminal event', async () => {
    let emit: (text: string) => void = () => {}
    const signalList: AbortSignal[] = []
    const stream = new ReadableStream<Uint8Array>({ start(controller) { emit = (text) => controller.enqueue(new TextEncoder().encode(text)); emit(frame(started)) } })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path, options) => {
      if (String(path).endsWith('/cancel')) return json({ ...identity, accepted: true, settlement: 'unconfirmed' }, 202)
      if (options?.signal) signalList.push(options.signal)
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useHostRun())
    act(() => { void result.current.start(sessionId, 'new input') })
    await waitFor(() => expect(result.current.runs[sessionId]?.phase).toBe('streaming'))
    await act(async () => { await result.current.cancel(identity) })
    expect(result.current.controls[runControlKey(identity)].accepted).toBe(true)
    expect(result.current.pending?.phase).toBe('streaming')
    expect(signalList[0].aborted).toBe(false)
    await act(async () => { expect(await result.current.reconcile(identity)).toBe(false); expect(await result.current.start(sessionId, 'must not overlap')).toBe(false) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { emit(frame(envelope(2, { kind: 'run.cancelled' }))) })
    await waitFor(() => expect(result.current.runs[sessionId].phase).toBe('cancelled'))
    expect(result.current.pending).toBeUndefined()
  })

  it('does not let a late stop receipt replace normal completion', async () => {
    let finish: (value: Response) => void = () => {}
    let emit: (text: string) => void = () => {}
    const stream = new ReadableStream<Uint8Array>({ start(controller) { emit = (text) => controller.enqueue(new TextEncoder().encode(text)); emit(frame(started)) } })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (path) => String(path).endsWith('/cancel') ? new Promise<Response>((resolve) => { finish = resolve }) : new Response(stream, { headers: { 'content-type': 'text/event-stream' } })))
    const { result } = renderHook(() => useHostRun())
    act(() => { void result.current.start(sessionId, 'new input') })
    await waitFor(() => expect(result.current.runs[sessionId]?.phase).toBe('streaming'))
    act(() => { void result.current.cancel(identity) })
    await act(async () => { emit(frame({ ...completed, sequence: 2 })) })
    await waitFor(() => expect(result.current.runs[sessionId].phase).toBe('completed'))
    await act(async () => { finish(json({ ...identity, accepted: true, settlement: 'unconfirmed' }, 202)) })
    await waitFor(() => expect(result.current.controlPending).toBe(false))
    expect(result.current.runs[sessionId].phase).toBe('completed')
    expect(result.current.runs[sessionId].text).toBe('Hello 世界')
  })

  it('retains unknown state after false or failed reconciliation and only unlocks after matching settled evidence', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(frame(started) + frame(envelope(2, { kind: 'assistant.text.delta', delta: 'Partial output' }))))
      .mockResolvedValueOnce(json({ ...identity, settled: false }))
      .mockResolvedValueOnce(json({ code: 'run_not_found', message: 'Run was not found for this Agent Session.' }, 404))
      .mockResolvedValueOnce(json({ ...identity, run_id: sessionId, settled: true }))
      .mockResolvedValueOnce(json({ ...identity, settled: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useHostRun())
    await act(async () => { await result.current.start(sessionId, 'new input') })
    expect(result.current.pending?.phase).toBe('unknown')
    for (let attempt = 0; attempt < 3; attempt++) {
      await act(async () => { await result.current.reconcile(identity) })
      expect(result.current.pending?.phase).toBe('unknown')
      await act(async () => { expect(await result.current.start(sessionId, 'not replayed')).toBe(false) })
    }
    await act(async () => { await result.current.reconcile(identity) })
    expect(result.current.pending).toBeUndefined()
    expect(result.current.runs[sessionId]).toMatchObject({ phase: 'settled', text: 'Partial output', runId })
    expect(result.current.runs[sessionId].events.some((event) => event.event.kind === 'run.completed')).toBe(false)
    expect(result.current.settledAt).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('does not unlock a known unknown Run when another identity is reconciled', async () => {
    const other = { session_id: runId, run_id: sessionId }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(frame(started))).mockResolvedValueOnce(json({ ...other, settled: true })))
    const { result } = renderHook(() => useHostRun())
    await act(async () => { await result.current.start(sessionId, 'input'); await result.current.reconcile(other) })
    expect(result.current.pending?.runId).toBe(runId)
    expect(result.current.pending?.phase).toBe('unknown')
  })

  it('serializes control commands and retains a previous stop receipt when reconciliation fails', async () => {
    let finish: (value: Response) => void = () => {}
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Promise<Response>((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(json({ code: 'runtime_unavailable', message: 'The Agent runtime is unavailable.' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useHostRun())
    act(() => { void result.current.cancel(identity) })
    await waitFor(() => expect(result.current.controlPending).toBe(true))
    await act(async () => {
      expect(await result.current.cancel(identity)).toBe(false)
      expect(await result.current.reconcile(identity)).toBe(false)
      expect(await result.current.start(sessionId, 'must not submit')).toBe(false)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { finish(json({ ...identity, accepted: false, settlement: 'unconfirmed' }, 202)) })
    await waitFor(() => expect(result.current.controlPending).toBe(false))
    expect(result.current.controls[runControlKey(identity)].accepted).toBe(false)
    await act(async () => { await result.current.reconcile(identity) })
    expect(result.current.controls[runControlKey(identity)]).toMatchObject({ accepted: false, settled: null, error: { code: 'runtime_unavailable' } })
    expect(result.current.settledAt).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('Session Run control transport', () => {
  const identity = { session_id: sessionId, run_id: runId }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('accepts the frozen stop and reconciliation receipts', () => {
    const examples = z.array(z.object({ schema: z.string(), value: z.unknown() })).parse(JSON.parse(readFileSync(resolve('../docs/contracts/v0.1/examples.json'), 'utf8')))
    for (const [name, schema] of [['HostStopResponse', stopResponseSchema], ['HostReconcileResponse', reconcileResponseSchema]] as const) {
      const selected = examples.filter((example) => example.schema === name)
      expect(selected).toHaveLength(1)
      expect(schema.safeParse(selected[0].value).success).toBe(true)
    }
  })

  it('sends bodyless commands bound to local identity and preserves unconfirmed or unsettled receipts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...identity, accepted: true, settlement: 'unconfirmed' }, 202)).mockResolvedValueOnce(json({ ...identity, settled: false }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await cancelHostRun(identity, new AbortController().signal)).toMatchObject({ accepted: true, settlement: 'unconfirmed' })
    expect(await reconcileHostRun(identity, new AbortController().signal)).toMatchObject({ settled: false })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([`/api/v1/host/sessions/${sessionId}/runs/${runId}/cancel`, `/api/v1/host/sessions/${sessionId}/runs/${runId}/reconcile`])
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'POST' && options.body === undefined)).toBe(true)
  })

  it('rejects a foreign identity, incorrect status and fabricated settlement', async () => {
    for (const body of [{ ...identity, session_id: runId, settled: true }, { ...identity, run_id: sessionId, settled: true }, { ...identity, settled: 'true' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
      await expect(reconcileHostRun(identity, new AbortController().signal)).rejects.toThrow('unconfirmed')
    }
    for (const [body, status] of [[{ ...identity, accepted: true, settlement: 'confirmed' }, 202], [{ ...identity, accepted: true, settlement: 'unconfirmed' }, 200]] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body, status)))
      await expect(cancelHostRun(identity, new AbortController().signal)).rejects.toThrow('unconfirmed')
    }
  })

  it('preserves safe errors without retrying or treating run_not_found as settlement', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ code: 'run_not_found', message: 'Run was not found for this Agent Session.' }, 404)).mockRejectedValueOnce(new TypeError('private failure'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(reconcileHostRun(identity, new AbortController().signal)).rejects.toMatchObject({ code: 'run_not_found', status: 404 })
    await expect(cancelHostRun(identity, new AbortController().signal)).rejects.toThrow('outcome is unknown')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('Session POST-SSE transport', () => {
  it('submits new input only and decodes split UTF-8, CRLF and comments through a verified terminal', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(`: ping\r\n\r\n${frame(started)}${frame(envelope(2, { kind: 'assistant.text.delta', delta: 'Hello 世界' }))}${frame(completed)}`))
    vi.stubGlobal('fetch', fetchMock)
    const events: RunEvent[] = []
    await streamHostRun(sessionId, 'New input', new AbortController().signal, (event) => events.push(event))
    expect(events.map((event) => event.event.kind)).toEqual(['run.started', 'assistant.text.delta', 'run.completed'])
    expect(events[1].event).toMatchObject({ delta: 'Hello 世界' })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/host/sessions/${sessionId}/runs`)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ input_text: 'New input' }) })
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Last-Event-ID')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts every frozen public event example', () => {
    const examples = z.array(z.object({ schema: z.string(), value: z.unknown() })).parse(JSON.parse(readFileSync(resolve('../docs/contracts/v0.1/examples.json'), 'utf8')))
    const selected = examples.filter((example) => example.schema === 'HostStreamEvent')
    expect(selected).toHaveLength(11)
    for (const example of selected) expect(runEventSchema.safeParse(example.value).success).toBe(true)
  })

  it('does not apply the admission deadline to a successfully established long Run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let emit: (text: string) => void = () => { throw new Error('Stream not initialized') }
    const stream = new ReadableStream<Uint8Array>({ start(controller) { emit = (text) => controller.enqueue(new TextEncoder().encode(text)); emit(frame(started)) } })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    let ready: () => void = () => {}
    const first = new Promise<void>((resolve) => { ready = resolve })
    const operation = streamHostRun(sessionId, 'input', new AbortController().signal, () => ready())
    await first
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    emit(frame({ ...completed, sequence: 2 }))
    await operation
  })

  it('closes a pending reader on local abort without claiming verified cancellation', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(frame(started))) }, cancel })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    let ready: () => void = () => {}
    const first = new Promise<void>((resolve) => { ready = resolve })
    const events: RunEvent[] = []
    const operation = streamHostRun(sessionId, 'input', controller.signal, (event) => { events.push(event); ready() })
    await first
    controller.abort()
    await expect(operation).rejects.toThrow('outcome is unknown')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.event.kind)).toEqual(['run.started'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects foreign identity, gaps, duplicate events, mismatched SSE fields and repeated starts', async () => {
    const delta = envelope(2, { kind: 'assistant.text.delta', delta: 'partial' })
    for (const text of [
      frame({ ...started, session_id: runId }), frame(delta), frame(started) + frame({ ...delta, sequence: 4 }),
      frame(started) + frame({ ...delta, run_id: sessionId }), frame(started) + frame({ ...delta, event_id: started.event_id }),
      frame(started, 'other'), frame(started, undefined, runId), frame(started) + frame(envelope(2, { kind: 'run.started', target_id: 'primary' })),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(text)))
      await expect(streamHostRun(sessionId, 'input', new AbortController().signal, () => {})).rejects.toThrow('identity or event ordering')
    }
  })

  it('does not treat EOF, a completed assistant text, or a done sentinel as Run success', async () => {
    for (const text of ['', frame(started), frame(started) + frame(envelope(2, { kind: 'assistant.text.completed', text: 'partial' })), frame(started) + 'data: [DONE]\n\n']) {
      const fetchMock = vi.fn().mockResolvedValue(response(text))
      vi.stubGlobal('fetch', fetchMock)
      await expect(streamHostRun(sessionId, 'input', new AbortController().signal, () => {})).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('returns typed admission errors without starting or retrying a stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'target_busy', message: 'The Agent Target already has an active Run.' }), { status: 409, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const receive = vi.fn()
    await expect(streamHostRun(sessionId, 'input', new AbortController().signal, receive)).rejects.toMatchObject({ code: 'target_busy', status: 409 })
    expect(receive).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts failure and cancellation terminal events without fabricating completion', async () => {
    for (const event of [{ kind: 'run.cancelled' }, { kind: 'run.failed', error: { code: 'run_state_unknown', message: 'Run settlement is unknown.' } }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(frame(started) + frame(envelope(2, event)))))
      const events: RunEvent[] = []
      await streamHostRun(sessionId, 'input', new AbortController().signal, (value) => events.push(value))
      expect(events.at(-1)?.event.kind).toBe(event.kind)
    }
  })
})