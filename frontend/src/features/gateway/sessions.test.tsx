import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { GatewayHttpError, type GatewaySnapshot } from './api'
import { loadSession, loadSessionPage, sessionPagePath, sessionPageSchema, sessionSnapshotSchema } from './sessions-api'
import { SessionsWorkspace } from './sessions-workspace'

const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const session = {
  session_id: id(1), endpoint_id: id(2), endpoint_revision_id: id(3), status: 'active',
  created_at: '2026-10-14T10:00:00Z', last_activity_at: '2026-10-14T10:01:00Z',
  closed_at: null, error_message: null,
}
const snapshot = {
  session_id: id(1), status: 'active', updated_at: '2026-10-14T10:01:00Z',
  event_count: 3, last_error: null, upstream: null, upstream_availability: [],
  discovered_tools: [{ name: 'ops__inspect', input_schema: { type: 'object' } }],
  active_tool_calls: [], resource_reads: [],
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' },
})

const topology: GatewaySnapshot['topology'] = {
  endpoints: [{
    endpoint_id: id(2), slug: 'tools', display_name: 'Tools', mode: 'aggregate', enabled: true,
    endpoint_path: '/mcp/tools', advertised_url: null, bindings: [], metadata: {},
    current_revision: { revision_id: id(9), revision_number: 2, created_at: '2026-10-14T11:00:00Z' },
  }],
  upstreams: [{
    server_id: id(4), slug: 'operations', display_name: 'Operations', enabled: true, metadata: {},
    current_revision: { revision_id: id(10), revision_number: 2, created_at: '2026-10-14T11:00:00Z' },
    connection: { transport: 'streamable-http', url: 'https://upstream.example/mcp', headers: [], timeout_seconds: 30 },
  }],
}
const fetchMock = vi.fn<typeof fetch>()
function HistoryControls() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><button onClick={() => navigate(-1)}>History back</button><button onClick={() => navigate(1)}>History forward</button><span data-testid="path">{location.pathname + location.search}</span></>
}
function renderSessions(path = '/gateway/sessions') {
  return render(<MemoryRouter initialEntries={[path]}><HistoryControls /><SessionsWorkspace topology={topology} /></MemoryRouter>)
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => json(String(input).includes('/sessions?')
    ? { items: [session], next_cursor: null } : String(input).endsWith('/snapshot') ? snapshot : session))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MCP Session data boundary', () => {
  it('retains required diagnostic fields without inventing empty missing arrays', () => {
    expect(sessionPageSchema.parse({ items: [session], next_cursor: null }).items).toEqual([session])
    expect(sessionSnapshotSchema.parse(snapshot).discovered_tools[0].name).toBe('ops__inspect')
    expect(sessionPageSchema.safeParse({ items: [session] }).success).toBe(false)
    expect(sessionSnapshotSchema.safeParse({ ...snapshot, upstream_availability: undefined }).success).toBe(false)
  })

  it('encodes endpoint, status and opaque cursor parameters', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    await loadSessionPage(sessionPagePath({ endpointId: id(2), status: 'closed', cursor: 'opaque+/=&' }), new AbortController().signal)
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://gateway.example')
    expect(url.searchParams.get('endpoint_id')).toBe(id(2))
    expect(url.searchParams.get('status')).toBe('closed')
    expect(url.searchParams.get('cursor')).toBe('opaque+/=&')
    expect(url.searchParams.get('limit')).toBe('50')
  })

  it('preserves HTTP 404 separately from a connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      type: 'about:blank', title: 'Not found', status: 404,
      detail: 'Session was not found.', code: 'session_not_found',
    }, 404)))
    await expect(loadSession(id(1), new AbortController().signal)).rejects.toMatchObject({
      name: 'GatewayHttpError', status: 404,
    } satisfies Partial<GatewayHttpError>)
  })
})

describe('MCP Session diagnostics', () => {
  it('loads a real Session page shape and applies endpoint and lifecycle filters', async () => {
    const user = userEvent.setup()
    renderSessions()
    expect(await screen.findByRole('link', { name: id(1) })).toBeDefined()
    expect(within(screen.getByRole('table', { name: 'MCP Sessions' })).getByText('Tools')).toBeDefined()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Endpoint filter' }), id(2))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status filter' }), 'closed')
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('status=closed'))
    const query = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'https://gateway.example').searchParams
    expect(query.get('endpoint_id')).toBe(id(2))
    expect(query.get('status')).toBe('closed')
    expect(screen.queryByRole('combobox', { name: /upstream/i })).toBeNull()
  })

  it('uses opaque cursor URLs, restores the prior page and clears cursor on filter changes', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input) => json(String(input).includes('cursor=')
      ? { items: [{ ...session, session_id: id(5) }], next_cursor: null }
      : { items: [session], next_cursor: 'opaque+/=&' }))
    renderSessions()
    await user.click(await screen.findByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('link', { name: id(5) })).toBeDefined()
    expect(screen.queryByRole('link', { name: id(1) })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'History back' }))
    expect(await screen.findByRole('link', { name: id(1) })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('link', { name: id(5) })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status filter' }), 'failed')
    await screen.findByRole('link', { name: id(1) })
    expect(screen.getByTestId('path').textContent).toContain('status=failed')
    expect(screen.getByTestId('path').textContent).not.toContain('cursor=')
  })

  it('does not let a superseded filter request replace the selected results', async () => {
    const user = userEvent.setup()
    let finishOld: (response: Response) => void = () => { throw new Error('Old request not started') }
    const oldSignals: AbortSignal[] = []
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes('status=closed')) return Promise.resolve(json({ items: [{ ...session, session_id: id(5), status: 'closed' }], next_cursor: null }))
      if (init?.signal) oldSignals.push(init.signal)
      return new Promise<Response>((resolve) => { finishOld = resolve })
    })
    renderSessions()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status filter' }), 'closed')
    await screen.findByRole('link', { name: id(5) })
    expect(oldSignals[0]?.aborted).toBe(true)
    await act(async () => { finishOld(json({ items: [session], next_cursor: null })); await Promise.resolve() })
    expect(screen.queryByRole('link', { name: id(1) })).toBeNull()
  })

  it('opens a deep-linked lifecycle and distinguishes captured from current revision', async () => {
    renderSessions(`/gateway/sessions/${id(1)}`)
    const lifecycle = await screen.findByRole('region', { name: 'Lifecycle' })
    expect(within(lifecycle).getByRole('link', { name: 'Tools' })).toBeDefined()
    expect(within(lifecycle).getByText('Not closed')).toBeDefined()
    expect(within(lifecycle).getByText('Captured endpoint revision differs from the current configuration.')).toBeDefined()
    expect(within(lifecycle).getByText(id(3)).closest('details')?.open).toBe(false)
    expect(await screen.findByText('ops__inspect')).toBeDefined()
    expect(screen.getByText('No initialization recorded')).toBeDefined()
  })

  it('returns from details to filtered results with original link focus', async () => {
    const user = userEvent.setup()
    renderSessions('/gateway/sessions?status=active')
    const origin = await screen.findByRole('link', { name: id(1) })
    await user.click(origin)
    await screen.findByRole('region', { name: 'Lifecycle' })
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: id(1) })))
    expect(screen.getByTestId('path').textContent).toBe('/gateway/sessions?status=active')
    expect((screen.getByRole('combobox', { name: 'Session status filter' }) as HTMLSelectElement).value).toBe('active')
  })

  it('keeps lifecycle visible when snapshot fails independently', async () => {
    fetchMock.mockImplementation(async (input) => String(input).endsWith('/snapshot')
      ? json({ detail: 'Snapshot temporarily unavailable' }, 503) : json(session))
    renderSessions(`/gateway/sessions/${id(1)}`)
    await screen.findByRole('region', { name: 'Lifecycle' })
    expect(await screen.findByText('Unable to load Snapshot')).toBeDefined()
    expect(screen.queryByText('Session not found')).toBeNull()
  })

  it('keeps snapshot visible when lifecycle read fails independently', async () => {
    fetchMock.mockImplementation(async (input) => String(input).endsWith('/snapshot') ? json(snapshot) : json({}, 503))
    renderSessions(`/gateway/sessions/${id(1)}`)
    expect(await screen.findByText('ops__inspect')).toBeDefined()
    expect(await screen.findByText('Unable to load Session')).toBeDefined()
  })

  it('distinguishes Session 404 from transport errors and from empty list', async () => {
    fetchMock.mockImplementation(async () => json({}, 404))
    renderSessions(`/gateway/sessions/${id(1)}`)
    expect(await screen.findByText('Session not found')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Lifecycle' })).toBeNull()
    expect(screen.queryByText('No MCP Sessions match these filters')).toBeNull()
  })

  it('renders a genuine empty page without inventing a Session', async () => {
    fetchMock.mockImplementation(async () => json({ items: [], next_cursor: null }))
    renderSessions()
    expect(await screen.findByText('No MCP Sessions match these filters')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('retains prior lifecycle, snapshot and read timestamps after a failed refresh', async () => {
    const user = userEvent.setup()
    renderSessions(`/gateway/sessions/${id(1)}`)
    await screen.findByText('ops__inspect')
    const timestamps = screen.getAllByText(/Read at/).map((element) => element.textContent)
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    await user.click(refresh)
    expect(await screen.findByText('Refresh failed - showing previous Snapshot')).toBeDefined()
    expect(screen.getByRole('region', { name: 'Lifecycle' })).toBeDefined()
    expect(screen.getByText('ops__inspect')).toBeDefined()
    expect(screen.getAllByText(/Read at/).map((element) => element.textContent)).toEqual(timestamps)
    expect(document.activeElement).toBe(refresh)
  })

  it('shows initialization, availability, tools, active calls and resource-read facts', async () => {
    fetchMock.mockImplementation(async (input) => json(String(input).endsWith('/snapshot') ? {
      ...snapshot,
      upstream: { server_name: 'Gateway aggregate', protocol_version: '2025-06-18', supports_tools: true, supports_resources: false },
      upstream_availability: [{ upstream_server_id: id(4), upstream_revision_id: id(6), binding_revision_id: id(7), namespace: 'ops', status: 'unavailable', failure_kind: 'initialization_failed', error_message: 'Connection refused', updated_at: snapshot.updated_at }],
      active_tool_calls: [{ call_id: 'call-1', tool_name: 'ops__inspect', status: 'running', started_at: session.created_at }],
      resource_reads: [{ requested_uri: 'ui://inspection', loaded_at: snapshot.updated_at, contents: [{ mime_type: 'text/html', text: '<script>not rendered</script>' }] }],
    } : session))
    renderSessions(`/gateway/sessions/${id(1)}`)
    expect(await screen.findByText('Gateway aggregate')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Operations' })).toBeDefined()
    expect(screen.getByText('initialization_failed: Connection refused')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Active tool calls (1)' })).toBeDefined()
    expect(screen.getByText('ui://inspection')).toBeDefined()
    expect(screen.queryByText('not rendered')).toBeNull()
  })

  it('rejects invalid filters and Session IDs without issuing diagnostic requests', () => {
    renderSessions('/gateway/sessions?status=online')
    expect(screen.getByRole('alert').textContent).toContain('Invalid Session filters')
    expect(fetchMock).not.toHaveBeenCalled()
    cleanup()
    renderSessions('/gateway/sessions/not-a-uuid')
    expect(screen.getByRole('alert').textContent).toBe('Invalid Session ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})