import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHostSession, historySchema, hostSessionPageSchema, hostSessionSchema, loadHostHistory, loadHostSession, loadHostSessions } from './api'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { featureKeys } from '@/features/status/api'
import { AgentHostWorkspace } from './agent-host-workspace'
import { RunPanel } from './run-panel'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const session = { session_id: id(1), target_id: 'primary', title: 'Inspection', created_at: '2026-10-15T00:00:00Z', binding_state: 'unknown', target_run: null }
const query = { limit: 100, offset: 0, order: 'latest' as const }
const history = { session_id: id(1), query, has_more: null, messages: [
  { message_id: 'user-1', role: 'user', content: [{ kind: 'text', text: 'Inspect the value' }] },
  { message_id: 'assistant-1', role: 'assistant', content: [{ kind: 'tool_call', tool_call_id: 'call-1', tool_name: 'inspect', arguments: { value: 42 } }] },
  { message_id: 'tool-1', role: 'tool', tool_call_id: 'call-1', tool_name: 'inspect', content: [{ kind: 'text', text: '<script>unsafe()</script>' }, { kind: 'unsupported', content_type: 'image' }] },
] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn<typeof fetch>()
const feature = { implemented: true, enabled: true, availability: 'available', reason: 'remote_verified', remote_support: true }
const capabilities = { gateway: { topology_read: true, session_inspection: true }, agent_host: { enabled: true, features: Object.fromEntries(featureKeys.map((key) => [key, feature])) } }
const responseFor = (input: RequestInfo | URL) => json(String(input).endsWith('/capabilities') ? capabilities : String(input).includes('/history?') ? history : String(input).includes('/sessions?') ? { sessions: [session], limit: 20, offset: 0, has_more: false } : session)
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async (input) => responseFor(input)); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('scrollTo', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Host Session data boundary', () => {
  it('creates with only an optional title and requires a public 201 Session response', async () => {
    fetchMock.mockResolvedValueOnce(json(session, 201))
    expect(await createHostSession('  Investigation  ', new AbortController().signal)).toMatchObject({ session_id: id(1) })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ title: 'Investigation' }) })
    fetchMock.mockResolvedValueOnce(json(session, 201))
    await createHostSession(' ', new AbortController().signal)
    expect(fetchMock.mock.calls[1][1]?.body).toBe('{}')
    fetchMock.mockResolvedValueOnce(json(session))
    await expect(createHostSession('', new AbortController().signal)).rejects.toThrow('not been retried')
    fetchMock.mockResolvedValueOnce(new Response('private invalid response body', { status: 201, headers: { 'content-type': 'application/json' } }))
    await expect(createHostSession('', new AbortController().signal)).rejects.toThrow('The Host creation response is invalid.')
  })

  it('does not retry creation after an uncertain submission or a typed rejection', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('private network details'))
    await expect(createHostSession('', new AbortController().signal)).rejects.toThrow('outcome is unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(json({ code: 'unsupported_operation', message: 'This Host operation is not enabled or supported.' }, 503))
    await expect(createHostSession('', new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported_operation', status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends explicit bounded history parameters and preserves chronological runtime order', async () => {
    fetchMock.mockResolvedValueOnce(json(history))
    const page = await loadHostHistory(id(1), query, new AbortController().signal)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/host/sessions/${id(1)}/history?limit=100&offset=0&order=latest`)
    expect(page.messages.map((message) => message.message_id)).toEqual(['user-1', 'assistant-1', 'tool-1'])
    expect(page.has_more).toBeNull()
    expect(historySchema.parse({ ...history, messages: [] }).has_more).toBeNull()
  })

  it('preserves safe Host codes and never substitutes missing remote history with an empty page', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'remote_session_not_found', message: 'The remote Session is missing.' }, 404))
    await expect(loadHostHistory(id(1), query, new AbortController().signal)).rejects.toMatchObject({ name: 'HostHttpError', status: 404, code: 'remote_session_not_found' })
  })

  it('rejects foreign Session identities and incorrect page boundaries', async () => {
    for (const value of [{ ...history, session_id: id(2) }, { ...history, query: { ...query, offset: 100 } }, { ...history, messages: [history.messages[0], history.messages[0]] }]) {
      fetchMock.mockResolvedValueOnce(json(value))
      await expect(loadHostHistory(id(1), query, new AbortController().signal)).rejects.toThrow('invalid page boundary')
    }
    fetchMock.mockResolvedValueOnce(json({ ...session, session_id: id(2) }))
    await expect(loadHostSession(id(1), new AbortController().signal)).rejects.toThrow('another Session')
    fetchMock.mockResolvedValueOnce(json({ sessions: [], limit: 20, offset: 0, has_more: true }))
    await expect(loadHostSessions(0, new AbortController().signal)).rejects.toThrow('boundary')
  })

  it('accepts the frozen public Session and runtime-owned history examples', () => {
    const examples = z.array(z.object({ schema: z.string(), value: z.unknown() })).parse(JSON.parse(readFileSync(resolve('../docs/contracts/v0.1/examples.json'), 'utf8')))
    for (const [name, schema] of [['HostSessionResponse', hostSessionSchema], ['HostSessionPageResponse', hostSessionPageSchema], ['AgentHistoryPage', historySchema]] as const) {
      const selected = examples.filter((example) => example.schema === name)
      expect(selected.length).toBeGreaterThan(0)
      for (const example of selected) expect(schema.safeParse(example.value).success).toBe(true)
    }
  })
})

describe('Agent Host Session browsing', () => {
  it('sends Enter, keeps Shift+Enter as a newline and does not submit an IME composition', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, options) => options?.method === 'POST' ? new Response('', { headers: { 'content-type': 'text/event-stream' } }) : String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available' }) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    const input = screen.getByRole('textbox', { name: 'New input' })
    await user.type(input, 'Hello')
    await user.keyboard('{Shift>}{Enter}{/Shift}World')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    await user.keyboard('{Enter}')
    await screen.findByText('Run unknown')
    expect(fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')?.[1]?.body).toBe(JSON.stringify({ input_text: 'Hello\nWorld' }))
    expect(document.activeElement).toBe(input)
  })

  it('keeps the composer outside scrolling messages and pauses following when reading older content', async () => {
    const user = userEvent.setup()
    const run = { sessionId: id(1), runId: id(3), input: 'Inspect', text: 'First fragment', phase: 'streaming' as const, events: [], finishedAt: null, error: null }
    const props = { conversationKey: id(1), run, draft: '', onDraft: vi.fn(), send: vi.fn(), disabled: true, available: true }
    const view = render(<RunPanel {...props} />)
    const viewport = screen.getByLabelText('Conversation messages')
    Object.defineProperties(viewport, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 400 } })
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    view.rerender(<RunPanel {...props} run={{ ...run, text: 'Another fragment' }} />)
    expect(viewport.scrollTop).toBe(0)
    expect(viewport.contains(screen.getByRole('textbox', { name: 'New input' }))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Latest messages' }))
    expect(viewport.scrollTop).toBe(1200)
    expect(screen.queryByRole('button', { name: 'Latest messages' })).toBeNull()
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    view.rerender(<RunPanel {...props} draft="New turn" disabled={false} />)
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    expect(props.send).toHaveBeenCalledTimes(1)
    expect(viewport.scrollTop).toBe(1200)
    expect(screen.queryByRole('button', { name: 'Latest messages' })).toBeNull()
  })

  it('shows stop acceptance without cancelling the stream or enabling another Run', async () => {
    const user = userEvent.setup()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const signals: AbortSignal[] = []
    const emit = (sequence: number, event: unknown) => { const value = { session_id: id(1), run_id: id(3), event_id: id(100 + sequence), sequence, created_at: '2026-10-15T00:00:00Z', event }; controller!.enqueue(new TextEncoder().encode(`id: ${value.event_id}\nevent: ${(event as { kind: string }).kind}\ndata: ${JSON.stringify(value)}\n\n`)) }
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith('/cancel')) return json({ session_id: id(1), run_id: id(3), accepted: true, settlement: 'unconfirmed' }, 202)
      if (options?.method === 'POST') { if (options.signal) signals.push(options.signal); return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), { headers: { 'content-type': 'text/event-stream' } }) }
      return String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available' }) : responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'New input')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    await waitFor(() => expect(controller).toBeDefined())
    await act(async () => { emit(1, { kind: 'run.started', target_id: 'primary' }) })
    await user.click(await screen.findByRole('button', { name: 'Stop Run' }))
    expect(await screen.findByText('Stop accepted / settlement unconfirmed')).toBeDefined()
    expect(screen.getByText('Run streaming')).toBeDefined()
    expect(signals[0].aborted).toBe(false)
    expect(screen.getByRole('button', { name: 'Reconcile Run' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { emit(2, { kind: 'run.cancelled' }) })
    expect(await screen.findByText('Run cancelled')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Stop Run' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
  })

  it('keeps unknown output locked through false reconciliation and requires fresh metadata after settlement', async () => {
    const user = userEvent.setup()
    let settled = false
    let allowSettlement = false
    let activeRunId = id(3)
    const lease = { session_id: id(1), run_id: id(3), state: 'unsettled' }
    const value = { session_id: id(1), run_id: id(3), event_id: id(100), sequence: 1, created_at: '2026-10-15T00:00:00Z', event: { kind: 'run.started', target_id: 'primary' } }
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith('/reconcile')) { settled = allowSettlement; return json({ session_id: id(1), run_id: activeRunId, settled }) }
      if (options?.method === 'POST') {
        activeRunId = id(4)
        settled = false
        return new Response(`id: ${value.event_id}\nevent: run.started\ndata: ${JSON.stringify({ ...value, run_id: activeRunId })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
      }
      return String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available', target_run: settled ? null : { ...lease, run_id: activeRunId } }) : responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'Next turn')
    await user.click(screen.getByRole('button', { name: 'Reconcile Run' }))
    expect(await screen.findByText('Settlement unconfirmed / new input blocked')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    allowSettlement = true
    await user.click(screen.getByRole('button', { name: 'Reconcile Run' }))
    expect(await screen.findByText('Settlement verified / original outcome not inferred')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Refresh Session' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    expect(await screen.findByText('Run unknown')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Reconcile Run' }))
    expect(await screen.findByText('Run settled')).toBeDefined()
    expect(screen.getByText('Settlement verified. Original Run outcome remains unknown.')).toBeDefined()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/runs'))).toHaveLength(1)
  })

  it('does not expose control for another Session until its owner is selected and gates capabilities independently', async () => {
    const user = userEvent.setup()
    const lease = { session_id: id(2), run_id: id(3), state: 'unsettled' }
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/capabilities')) return json({ ...capabilities, agent_host: { enabled: true, features: { ...capabilities.agent_host.features, run_cancel: { ...feature, availability: 'unknown', remote_support: null, reason: 'remote_unknown' } } } })
      if (String(input).includes(`/sessions/${id(2)}/history?`)) return json({ ...history, session_id: id(2), messages: [] })
      if (String(input).endsWith(id(1)) || String(input).endsWith(id(2))) return json({ ...session, session_id: String(input).endsWith(id(2)) ? id(2) : id(1), binding_state: 'available', target_run: lease })
      return responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Target Run unsettled')
    expect(screen.queryByRole('button', { name: 'Stop Run' })).toBeNull()
    await user.click(screen.getByRole('link', { name: `Session: ${id(2)}` }))
    expect(await screen.findByText('Run cancellation: Unknown / Remote unknown')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Stop Run' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Reconcile Run' }).hasAttribute('disabled')).toBe(false)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('recovers uncertain admission only through discovered lease identity, never a guessed Run or input replay', async () => {
    const user = userEvent.setup()
    let submitted = false
    let settled = false
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith('/reconcile')) { settled = true; return json({ session_id: id(1), run_id: id(3), settled: true }) }
      if (options?.method === 'POST') { submitted = true; throw new TypeError('private network failure') }
      if (String(input).endsWith(id(1))) return json({ ...session, binding_state: 'available', target_run: submitted && !settled ? { session_id: id(1), run_id: id(3), state: 'unsettled' } : null })
      return responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'Only once')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    expect(await screen.findByText('Run unknown')).toBeDefined()
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(id(1))).length).toBeGreaterThan(1))
    await user.click(await screen.findByRole('button', { name: 'Reconcile Run' }))
    expect(await screen.findByText('Run settled')).toBeDefined()
    await user.type(screen.getByLabelText('New input'), 'A different new turn')
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Refresh Session' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(false))
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/runs'))).toHaveLength(1)
    expect(fetchMock.mock.calls.find(([input]) => String(input).endsWith('/reconcile'))?.[0]).toBe(`/api/v1/host/sessions/${id(1)}/runs/${id(3)}/reconcile`)
    expect(screen.queryByText('private network failure')).toBeNull()
  })

  it('creates a Session once, selects its stable ID, and keeps creation rejection visible', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, options) => options?.method === 'POST' ? json({ ...session, binding_state: 'available', title: 'Fresh Session' }, 201) : responseFor(input))
    render(<MemoryRouter initialEntries={['/agent-host']}><AgentHostWorkspace active /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'New Session' }).hasAttribute('disabled')).toBe(false))
    await user.type(screen.getByLabelText('Session title (optional)'), 'Fresh Session')
    await user.click(screen.getByRole('button', { name: 'New Session' }))
    expect(await screen.findByRole('link', { name: 'Created Session: Fresh Session' })).toBeDefined()
    expect(await screen.findByLabelText('New input')).toBeDefined()
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    fetchMock.mockImplementation(async (input, options) => options?.method === 'POST' ? json({ code: 'runtime_unavailable', message: 'The Agent runtime is unavailable.' }, 503) : responseFor(input))
    await user.click(screen.getByRole('button', { name: 'New Session' }))
    expect(await screen.findByText('runtime_unavailable / HTTP 503')).toBeDefined()
  })

  it('streams only new input, prevents duplicate submission, and preserves the live Run when switching Sessions', async () => {
    const user = userEvent.setup()
    const other = { ...session, session_id: id(2), title: 'Second conversation', binding_state: 'available' }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const signals: AbortSignal[] = []
    const emit = (sequence: number, event: unknown) => { const value = { session_id: id(1), run_id: id(3), event_id: id(100 + sequence), sequence, created_at: '2026-10-15T00:00:00Z', event }; controller!.enqueue(new TextEncoder().encode(`id: ${value.event_id}\nevent: ${(event as { kind: string }).kind}\ndata: ${JSON.stringify(value)}\n\n`)) }
    fetchMock.mockImplementation(async (input, options) => {
      if (options?.method === 'POST') { if (options.signal) signals.push(options.signal); return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), { headers: { 'content-type': 'text/event-stream' } }) }
      if (String(input).includes('/sessions?')) return json({ sessions: [session, other], limit: 20, offset: 0, has_more: false })
      if (String(input).includes(`/sessions/${id(2)}/history?`)) return json({ ...history, session_id: id(2), messages: [] })
      if (String(input).endsWith(id(2))) return json(other)
      if (String(input).endsWith(id(1))) return json({ ...session, binding_state: 'available' })
      return responseFor(input)
    })
    const view = render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'Only new input')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    await waitFor(() => expect(controller).toBeDefined())
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { emit(1, { kind: 'run.started', target_id: 'primary' }); emit(2, { kind: 'assistant.text.delta', delta: '<img src=x onerror=unsafe()>' }) })
    expect(await screen.findByLabelText('Current assistant output')).toHaveProperty('textContent', '<img src=x onerror=unsafe()>')
    await user.click(screen.getByRole('link', { name: 'Second conversation' }))
    expect(await screen.findByText('Run streaming /')).toBeDefined()
    expect(signals[0].aborted).toBe(false)
    await user.click(screen.getByRole('link', { name: 'Inspection' }))
    expect(await screen.findByLabelText('Current assistant output')).toBeDefined()
    view.rerender(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active={false} /></MemoryRouter>)
    expect(signals[0].aborted).toBe(false)
    await act(async () => { emit(3, { kind: 'run.completed', output_text: 'Final answer', usage: { input_tokens: 2, output_tokens: 3 } }) })
    view.rerender(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    expect(await screen.findByText('Run completed')).toBeDefined()
    expect(screen.getByLabelText('Current assistant output').textContent).toBe('Final answer')
    await user.type(screen.getByLabelText('New input'), 'Next turn')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(false))
    expect(document.querySelectorAll('#host-history-title img')).toHaveLength(0)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')?.[1]?.body).toBe(JSON.stringify({ input_text: 'Only new input' }))
  })

  it('automatically reads metadata and authoritative history after a terminal, independently of the server clock', async () => {
    const user = userEvent.setup()
    let submitted = false
    let finishMetadata: (response: Response) => void = () => { throw new Error('Metadata read not started') }
    const events = [{ kind: 'run.started', target_id: 'primary' }, { kind: 'run.completed', output_text: 'Finished', usage: {} }].map((event, index) => { const value = { session_id: id(1), run_id: id(3), event_id: id(100 + index), sequence: index + 1, created_at: '2099-10-15T00:00:00Z', event }; return `id: ${value.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(value)}\n\n` }).join('')
    fetchMock.mockImplementation(async (input, options) => {
      if (options?.method === 'POST') { submitted = true; return new Response(events, { headers: { 'content-type': 'text/event-stream' } }) }
      if (String(input).endsWith(id(1))) return submitted ? new Promise<Response>((resolve) => { finishMetadata = resolve }) : json({ ...session, binding_state: 'available' })
      if (String(input).includes('/history?') && submitted) return json({ ...history, messages: [...history.messages, { message_id: 'completed-1', role: 'assistant', content: [{ kind: 'text', text: 'Finished' }] }] })
      return responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'First turn')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    await screen.findByText('Run completed')
    await user.type(screen.getByLabelText('New input'), 'Second turn')
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Session metadata refresh required')).toBeDefined()
    await act(async () => { finishMetadata(json({ ...session, binding_state: 'available' })) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(false))
    expect(within(screen.getByRole('list', { name: 'Session history' })).getByText('Finished')).toBeDefined()
    expect(screen.getByText('Last turn snapshot').closest('details')?.open).toBe(false)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('retains the answer and blocks unsafe overlap when automatic metadata and history refresh fail, without replay', async () => {
    const user = userEvent.setup()
    let submitted = false
    let failRefresh = true
    const events = [{ kind: 'run.started', target_id: 'primary' }, { kind: 'run.completed', output_text: 'Retained answer', usage: {} }].map((event, index) => { const value = { session_id: id(1), run_id: id(3), event_id: id(100 + index), sequence: index + 1, created_at: '2026-10-15T00:00:00Z', event }; return `id: ${value.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(value)}\n\n` }).join('')
    fetchMock.mockImplementation(async (input, options) => {
      if (options?.method === 'POST') { submitted = true; return new Response(events, { headers: { 'content-type': 'text/event-stream' } }) }
      if (submitted && failRefresh && (String(input).endsWith(id(1)) || String(input).includes('/history?'))) return json({ code: 'runtime_unavailable', message: 'The runtime is unavailable.' }, 502)
      return String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available' }) : responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'First turn')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    await screen.findByText('Refresh failed - showing previous Session metadata')
    expect(await screen.findByText('Refresh failed - showing previous Session history')).toBeDefined()
    expect(screen.getByLabelText('Current assistant output').textContent).toBe('Retained answer')
    expect(screen.queryByText('Last turn snapshot')).toBeNull()
    await user.type(screen.getByLabelText('New input'), 'Do not retry automatically')
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    failRefresh = false
    await user.click(screen.getByRole('button', { name: 'Refresh Session' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(false))
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it.each(['oldest', 'latest'])('does not hide the current answer when refreshing an older %s history window', async (order) => {
    const user = userEvent.setup()
    const events = [{ kind: 'run.started', target_id: 'primary' }, { kind: 'run.completed', output_text: 'Current answer', usage: {} }].map((event, index) => { const value = { session_id: id(1), run_id: id(3), event_id: id(100 + index), sequence: index + 1, created_at: '2026-10-15T00:00:00Z', event }; return `id: ${value.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(value)}\n\n` }).join('')
    fetchMock.mockImplementation(async (input, options) => options?.method === 'POST' ? new Response(events, { headers: { 'content-type': 'text/event-stream' } }) : String(input).includes('/history?') ? json({ ...history, query: { ...query, order, offset: 100 } }) : String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available' }) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}?history_order=${order}&history_offset=100`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'New question')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    await screen.findByText('Run completed')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/history?'))).toHaveLength(2))
    expect(screen.getByLabelText('Current assistant output').textContent).toBe('Current answer')
    expect(screen.queryByText('Last turn snapshot')).toBeNull()
  })

  it('does not submit new input when remote streaming support is unknown', async () => {
    fetchMock.mockImplementation(async (input) => String(input).endsWith('/capabilities') ? json({ ...capabilities, agent_host: { enabled: true, features: { ...capabilities.agent_host.features, session_streaming: { ...feature, availability: 'unknown', remote_support: null, reason: 'remote_unknown' } } } }) : String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available' }) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    expect(await screen.findByText('Session streaming: Unknown / Remote unknown')).toBeDefined()
    expect(screen.getByLabelText('New input').hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('keeps partial output and blocks new input after an unconfirmed stream end without replay', async () => {
    const user = userEvent.setup()
    const events = [{ kind: 'run.started', target_id: 'primary' }, { kind: 'assistant.text.delta', delta: 'Partial answer' }].map((event, index) => { const value = { session_id: id(1), run_id: id(3), event_id: id(100 + index), sequence: index + 1, created_at: '2026-10-15T00:00:00Z', event }; return `id: ${value.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(value)}\n\n` }).join('')
    fetchMock.mockImplementation(async (input, options) => options?.method === 'POST' ? new Response(events, { headers: { 'content-type': 'text/event-stream' } }) : String(input).endsWith(id(1)) ? json({ ...session, binding_state: 'available' }) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    await user.type(screen.getByLabelText('New input'), 'Inspect now')
    await user.click(screen.getByRole('button', { name: 'Send input' }))
    expect(await screen.findByText('Run unknown')).toBeDefined()
    expect(screen.getByLabelText('Current assistant output').textContent).toBe('Partial answer')
    await user.type(screen.getByLabelText('New input'), 'Do not replay')
    expect(screen.getByRole('button', { name: 'Send input' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('renders runtime text, tool calls and unsupported content without active HTML', async () => {
    fetchMock.mockImplementation(async (input) => json(String(input).endsWith('/capabilities') ? capabilities : String(input).includes('/history?') ? history : String(input).includes('/sessions?') ? { sessions: [session], limit: 20, offset: 0, has_more: false } : session))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    const messages = await screen.findByRole('list', { name: 'Session history' })
    expect(within(messages).getByText('Inspect the value')).toBeDefined()
    expect(within(messages).getByText('Tool call: inspect')).toBeDefined()
    expect(within(messages).getByText('Unsupported content: image')).toBeDefined()
    expect(within(messages).getByText('<script>unsafe()</script>')).toBeDefined()
    expect(messages.querySelectorAll('script, iframe, img')).toHaveLength(0)
    expect(screen.getByText('History offset: 0 / More history: Unknown')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Older messages' })).toBeDefined()
  })

  it('shows disabled Session capability instead of claiming the local list is empty', async () => {
    fetchMock.mockResolvedValue(json({ ...capabilities, agent_host: { enabled: true, features: Object.fromEntries(featureKeys.map((key) => [key, { ...feature, enabled: false, availability: 'disabled', reason: 'local_disabled' }])) } }))
    render(<MemoryRouter initialEntries={['/agent-host']}><AgentHostWorkspace active /></MemoryRouter>)
    expect(await screen.findByText('Session list: Disabled / Local disabled')).toBeDefined()
    expect(screen.queryByText('No Agent Sessions')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps unknown remote history support unavailable without hiding local Session metadata', async () => {
    fetchMock.mockImplementation(async (input) => String(input).endsWith('/capabilities') ? json({ ...capabilities, agent_host: { enabled: true, features: { ...capabilities.agent_host.features, session_history: { ...feature, availability: 'unknown', remote_support: null, reason: 'remote_unknown' } } } }) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    expect(await screen.findByText('Session history: Unknown / Remote unknown')).toBeDefined()
    expect(await screen.findByText('Binding state')).toBeDefined()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/history?'))).toBe(false)
    expect(screen.queryByText('No messages in this history window')).toBeNull()
  })

  it('reports missing remote history with its safe error code, not an empty history', async () => {
    fetchMock.mockImplementation(async (input) => String(input).includes('/history?') ? json({ code: 'remote_session_not_found', message: 'The remote Session is missing.' }, 404) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    expect(await screen.findByText('remote_session_not_found / HTTP 404')).toBeDefined()
    expect(screen.getByText('Binding state')).toBeDefined()
    expect(screen.queryByText('No messages in this history window')).toBeNull()
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('requests another bounded window for unknown has_more and retains chronological message order', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/history?')) {
        const params = new URL(String(input), 'https://host.example').searchParams
        const offset = Number(params.get('offset'))
        return json({ ...history, query: { ...query, offset, order: params.get('order') }, messages: offset === 0 ? history.messages : [], has_more: null })
      }
      return responseFor(input)
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Older messages' }))
    expect(await screen.findByText('No messages in this history window')).toBeDefined()
    expect(screen.getByText('History offset: 100 / More history: Unknown')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Older messages' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Newer messages' }))
    await screen.findByRole('list', { name: 'Session history' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'History order' }), 'oldest')
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/history?limit=100&offset=0&order=oldest'))).toBe(true))
    expect((await screen.findByRole('list', { name: 'Session history' })).querySelector('li')?.textContent).toContain('Inspect the value')
  })

  it('keeps the current history window and timestamp after refresh failure and retries without replay', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByRole('list', { name: 'Session history' })
    const section = within(screen.getByRole('list', { name: 'Session history' }).closest('section')!)
    const timestamps = section.getAllByText(/Read at/).map((node) => node.textContent)
    fetchMock.mockImplementation(async (input) => String(input).includes('/history?') ? json({ code: 'runtime_unavailable', message: 'The runtime is unavailable.' }, 503) : responseFor(input))
    await user.click(screen.getByRole('button', { name: 'Refresh Session' }))
    expect(await screen.findByText('Refresh failed - showing previous Session history')).toBeDefined()
    expect(screen.getByText('runtime_unavailable / HTTP 503')).toBeDefined()
    expect(section.getAllByText(/Read at/).at(-1)?.textContent).toBe(timestamps.at(-1))
    expect(screen.getByText('Inspect the value')).toBeDefined()
    fetchMock.mockImplementation(async (input) => responseFor(input))
    await user.click(screen.getByRole('button', { name: 'Refresh Session' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/sessions?'))).toHaveLength(1)
  })

  it('cancels stale history when switching Sessions and ignores the late response', async () => {
    const user = userEvent.setup()
    const signals: AbortSignal[] = []
    let finishOld: (response: Response) => void = () => { throw new Error('Old history not started') }
    const other = { ...session, session_id: id(2), title: 'Second conversation' }
    fetchMock.mockImplementation((input, options) => {
      const path = String(input)
      if (path.includes('/sessions?')) return Promise.resolve(json({ sessions: [session, other], limit: 20, offset: 0, has_more: false }))
      if (path.includes(`/sessions/${id(1)}/history?`)) {
        if (options?.signal) signals.push(options.signal)
        return new Promise<Response>((resolve) => { finishOld = resolve })
      }
      if (path.includes(`/sessions/${id(2)}/history?`)) return Promise.resolve(json({ ...history, session_id: id(2), messages: [{ message_id: 'other-1', role: 'assistant', content: [{ kind: 'text', text: 'Second history' }] }] }))
      return Promise.resolve(path.endsWith(id(2)) ? json(other) : responseFor(input))
    })
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await waitFor(() => expect(signals).toHaveLength(1))
    await user.click(await screen.findByRole('link', { name: 'Second conversation' }))
    expect(await screen.findByText('Second history')).toBeDefined()
    expect(signals[0].aborted).toBe(true)
    await act(async () => { finishOld(json(history)) })
    expect(screen.queryByText('Inspect the value')).toBeNull()
    expect(screen.getByText('Second history')).toBeDefined()
  })

  it('shows a Target lease belonging to another Session but does not revive a stale lease after verified null', async () => {
    const run = { session_id: id(2), run_id: id(3), state: 'unsettled' }
    fetchMock.mockImplementation(async (input) => String(input).includes('/sessions?') ? json({ sessions: [{ ...session, target_run: run }], limit: 20, offset: 0, has_more: false }) : String(input).endsWith(id(1)) ? json({ ...session, target_run: run }) : responseFor(input))
    const view = render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    expect(await screen.findByText('Target Run unsettled')).toBeDefined()
    expect(screen.getByRole('link', { name: `Session: ${id(2)}` }).getAttribute('href')).toBe(`/agent-host/sessions/${id(2)}`)
    view.unmount()
    fetchMock.mockImplementation(async (input) => String(input).includes('/sessions?') ? json({ sessions: [{ ...session, target_run: run }], limit: 20, offset: 0, has_more: false }) : responseFor(input))
    render(<MemoryRouter initialEntries={[`/agent-host/sessions/${id(1)}`]}><AgentHostWorkspace active /></MemoryRouter>)
    await screen.findByText('Binding state')
    expect(screen.queryByText('Target Run unsettled')).toBeNull()
    expect(screen.queryByText(/Target idle/)).toBeNull()
  })

  it('keeps local paging bounded and does not read invalid Session IDs or history query values', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/sessions?')) {
        const offset = Number(new URL(String(input), 'https://host.example').searchParams.get('offset'))
        return json({ sessions: [session], offset, limit: 20, has_more: offset === 0 })
      }
      return responseFor(input)
    })
    const view = render(<MemoryRouter initialEntries={['/agent-host']}><AgentHostWorkspace active /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Next Sessions' }))
    expect(await screen.findByRole('button', { name: 'Previous Sessions' })).toBeDefined()
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/sessions?limit=20&offset=20'))).toBe(true))
    view.unmount()
    fetchMock.mockClear()
    render(<MemoryRouter initialEntries={['/agent-host/sessions/not-a-uuid?offset=-1&history_offset=no']}><AgentHostWorkspace active /></MemoryRouter>)
    expect(screen.getByText('Invalid Agent Session ID')).toBeDefined()
    expect(screen.getByText('Invalid Session page offset')).toBeDefined()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh capabilities' }).hasAttribute('disabled')).toBe(false))
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual(['/api/v1/capabilities'])
  })
})