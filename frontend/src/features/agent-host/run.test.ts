import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { runEventSchema, streamHostRun, type RunEvent } from './run-transport'

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
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

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