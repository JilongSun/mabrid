import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { historySchema, hostSessionPageSchema, hostSessionSchema, loadHostHistory, loadHostSession, loadHostSessions } from './api'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { featureKeys } from '@/features/status/api'
import { AgentHostWorkspace } from './agent-host-workspace'
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