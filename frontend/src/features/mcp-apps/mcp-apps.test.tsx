import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppRendererProps } from '@mcp-ui/client'
import { prepareAppResource, type HostWidget } from './app-resource'
import { appSecurityPolicy } from './app-policy'
import { WidgetRenderer } from './app-renderer'
import { McpApps, SessionApps } from './mcp-apps'
import { runEventSchema } from '@/features/agent-host/run-transport'
import { RunPanel } from '@/features/agent-host/run-panel'

const renderer = vi.hoisted(() => ({ props: null as AppRendererProps | null, broken: false }))
vi.mock('@mcp-ui/client', () => ({ AppRenderer: (props: AppRendererProps) => { renderer.props = props; if (renderer.broken) throw new Error('Private renderer failure'); return <iframe title="Controlled App proxy" /> } }))
afterEach(() => { cleanup(); renderer.props = null; renderer.broken = false; vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

const widget: HostWidget = {
  widget_id: '00000000-0000-4000-8000-000000000004', tool_invocation_id: '00000000-0000-4000-8000-000000000003', tool_name: 'inspect',
  application_resource_uri: 'ui://inspect/result', resource_metadata: {},
  resource_contents: [{ uri: 'ui://inspect/result', mime_type: 'text/html;profile=mcp-app', text: '<html><body>Result</body></html>' }],
  tool_result: { content: [{ type: 'text', text: 'Result' }], structured_content: { value: 42 }, is_error: false, metadata: { preserved: true } },
}

describe('Fresh MCP App resource boundary', () => {
  it('maps public tool results and preserves resource contents without fetching', () => {
    expect(prepareAppResource(widget)).toEqual({ html: widget.resource_contents[0].text, csp: { connectDomains: [], resourceDomains: [], baseUriDomains: [] }, toolResult: { content: [{ type: 'text', text: 'Result' }], structuredContent: { value: 42 }, isError: false, _meta: { preserved: true } } })
  })

  it('omits null public content annotations and metadata before SDK validation', () => {
    const prepared = prepareAppResource({ ...widget, tool_result: { ...widget.tool_result, content: [{ type: 'text', text: 'Result', annotations: null, meta: null }] } })
    expect(prepared.toolResult.content).toEqual([{ type: 'text', text: 'Result' }])
  })

  it('preserves non-null content annotations and maps public metadata to the MCP name', () => {
    const annotations = { audience: ['user'], priority: 0.5 }
    const prepared = prepareAppResource({ ...widget, tool_result: { ...widget.tool_result, content: [{ type: 'text', text: 'Result', annotations, meta: { source: 'mock' } }] } })
    expect(prepared.toolResult.content).toEqual([{ type: 'text', text: 'Result', annotations, _meta: { source: 'mock' } }])
  })

  it('decodes blob resources as UTF-8 rather than Latin-1', () => {
    const html = '<p>\u4e16\u754c</p>'
    const blob = btoa(String.fromCharCode(...new TextEncoder().encode(html)))
    expect(prepareAppResource({ ...widget, resource_contents: [{ ...widget.resource_contents[0], text: null, blob }] }).html).toBe(html)
  })

  it('defaults to no network, frames, forms or base URL and only adds declared HTTPS origins', () => {
    const empty = appSecurityPolicy({}).policy
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) expect(empty).toContain(directive)
    expect(appSecurityPolicy({ connectDomains: ['https://api.example'], resourceDomains: ['https://cdn.example'] })).toMatchObject({ csp: { connectDomains: ['https://api.example'], resourceDomains: ['https://cdn.example'] } })
  })

  it('preserves only explicitly declared base origins', () => {
    const prepared = prepareAppResource({ ...widget, resource_contents: [{ ...widget.resource_contents[0], metadata: { ui: { csp: { baseUriDomains: ['https://cdn.example'] } } } }] })
    expect(prepared.csp.baseUriDomains).toEqual(['https://cdn.example'])
    expect(appSecurityPolicy(prepared.csp).policy).toContain('base-uri https://cdn.example')
    expect(appSecurityPolicy({ resourceDomains: ['https://cdn.example'] }).policy).toContain("base-uri 'none'")
  })

  it.each(['http://localhost:8760', 'http://127.0.0.1:8760', 'http://[::1]:8760'])('allows declared loopback HTTP only in development: %s', (origin) => {
    vi.stubEnv('DEV', true)
    const declarations = { resourceDomains: [origin], connectDomains: [origin], baseUriDomains: [origin] }
    expect(appSecurityPolicy(declarations).csp).toEqual(declarations)
    expect(appSecurityPolicy(declarations).policy).toContain(`base-uri ${origin}`)
    vi.stubEnv('DEV', false)
    for (const field of ['resourceDomains', 'connectDomains', 'baseUriDomains']) expect(() => appSecurityPolicy({ [field]: [origin] })).toThrow('security policy is unsupported')
    expect(appSecurityPolicy({ resourceDomains: ['https://cdn.example'] }).csp.resourceDomains).toEqual(['https://cdn.example'])
  })

  it.each(['http://example.com', 'http://localhost.example.com', 'http://192.168.1.2', 'https://cdn.example/assets', 'https://user:password@cdn.example', 'https://cdn.example?query=1', 'https://cdn.example#fragment', '*', 'data:'])('rejects unsafe source declarations across all directives: %s', (source) => {
    for (const field of ['resourceDomains', 'connectDomains', 'baseUriDomains']) expect(() => appSecurityPolicy({ [field]: [source] })).toThrow('security policy is unsupported')
  })

  it.each([
    { application_resource_uri: 'https://remote.example/widget' },
    { resource_contents: [] },
    { resource_contents: [widget.resource_contents[0], widget.resource_contents[0]] },
    { resource_contents: [{ ...widget.resource_contents[0], uri: 'ui://different' }] },
    { resource_contents: [{ ...widget.resource_contents[0], mime_type: 'text/html' }] },
    { resource_contents: [{ ...widget.resource_contents[0], text: null, blob: 'invalid!' }] },
    { tool_result: { ...widget.tool_result, content: [{ type: 'image', data: 'missing-mime' }] } },
    { tool_result: { ...widget.tool_result, content: [{ type: 'text', text: 'Result', annotations: 'invalid' }] } },
    { resource_metadata: { ui: { csp: { connectDomains: ['https://safe.example; default-src *'] } } } },
    { resource_metadata: { ui: { csp: { resourceDomains: ['http://remote.example:8765'] } } } },
  ])('rejects unsupported or malformed payload %j without exposing its contents', (change) => {
    expect(() => prepareAppResource({ ...widget, ...change })).toThrow(/^The App /)
  })
})

describe('Ephemeral App lifecycle', () => {
  it('supplies validated input/result without a client, advertises no Host actions and rejects all follow-up methods', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<WidgetRenderer widget={widget} input={{ value: 42 }} />)
    const props = renderer.props!
    expect(props.client).toBeUndefined()
    expect(props.html).toBe(widget.resource_contents[0].text)
    expect(props.hostCapabilities).toEqual({})
    expect(props.toolInput).toEqual({ value: 42 })
    expect(props.toolResult).toMatchObject({ structuredContent: { value: 42 }, isError: false })
    expect(props.sandbox.url.pathname).toBe('/sandbox.html')
    for (const method of ['onMessage', 'onOpenLink', 'onCallTool', 'onReadResource', 'onListResources', 'onListResourceTemplates', 'onListPrompts', 'onFallbackRequest'] as const) {
      const handler = props[method] as () => Promise<unknown>
      await expect(handler()).rejects.toMatchObject({ code: -32601 })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts initialization only from the owned proxy and clamps untrusted sizes', async () => {
    render(<WidgetRenderer widget={widget} />)
    const frame = screen.getByLabelText('inspect App frame')
    const proxy = screen.getByTitle<HTMLIFrameElement>('Controlled App proxy')
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data: { method: 'ui/notifications/initialized' } }))
    expect(frame.getAttribute('aria-busy')).toBe('true')
    fireEvent(window, new MessageEvent('message', { origin: 'https://foreign.example', source: proxy.contentWindow, data: { method: 'ui/notifications/initialized' } }))
    expect(frame.getAttribute('aria-busy')).toBe('true')
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: proxy.contentWindow, data: { method: 'ui/notifications/initialized' } }))
    expect(frame.getAttribute('aria-busy')).toBe('false')
    act(() => renderer.props!.onSizeChanged!({ height: 99999, width: 99999 }))
    expect(frame.style.height).toBe('640px')
    act(() => renderer.props!.onSizeChanged!({ height: -1 }))
    expect(frame.style.height).toBe('160px')
    act(() => renderer.props!.onSizeChanged!({ height: Number.NaN }))
    expect(frame.style.height).toBe('160px')
  })

  it('closes and reloads only the delivered App without any request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<WidgetRenderer widget={widget} />)
    const previous = screen.getByTitle('Controlled App proxy')
    await user.click(screen.getByRole('button', { name: 'Close App' }))
    expect(screen.getByText('App closed')).toBeDefined()
    expect(screen.queryByTitle('Controlled App proxy')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reload App' }))
    expect(screen.getByTitle('Controlled App proxy')).not.toBe(previous)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('contains invalid resources, renderer errors and initialization timeouts', () => {
    vi.useFakeTimers()
    const view = render(<WidgetRenderer widget={{ ...widget, resource_contents: [] }} />)
    expect(screen.getByRole('alert').textContent).toContain('identity is invalid')
    view.unmount()
    const next = render(<WidgetRenderer widget={widget} />)
    act(() => renderer.props!.onError!(new Error('Private stack and upstream address')))
    expect(screen.getByRole('alert').textContent).toBe('App unavailable. The tool result is preserved.')
    next.unmount()
    render(<WidgetRenderer widget={widget} />)
    act(() => vi.advanceTimersByTime(12_000))
    expect(screen.getByRole('alert').textContent).toBe('App unavailable. The tool result is preserved.')
    expect(screen.queryByTitle('Controlled App proxy')).toBeNull()
  })

  it('gates frames independently and removes them when their live event collection is cleared', async () => {
    const event = runEventSchema.parse({ session_id: '00000000-0000-4000-8000-000000000001', run_id: '00000000-0000-4000-8000-000000000002', event_id: '00000000-0000-4000-8000-000000000005', sequence: 1, created_at: '2026-10-16T00:00:00Z', event: { kind: 'widget.created', widget } })
    const view = render(<McpApps events={[event]} available={false} />)
    expect(screen.getByText('App rendering is unavailable. Tool results are preserved.')).toBeDefined()
    expect(screen.queryByTitle('Controlled App proxy')).toBeNull()
    view.rerender(<McpApps events={[event]} available />)
    await screen.findByTitle('Controlled App proxy')
    expect(renderer.props!.toolInput).toBeUndefined()
    view.rerender(<McpApps events={[]} available />)
    expect(screen.queryByTitle('Controlled App proxy')).toBeNull()
  })

  it('retains an App outside a folded history snapshot and through an unconfirmed Run end', async () => {
    const event = runEventSchema.parse({ session_id: '00000000-0000-4000-8000-000000000001', run_id: '00000000-0000-4000-8000-000000000002', event_id: '00000000-0000-4000-8000-000000000005', sequence: 1, created_at: '2026-10-16T00:00:00Z', event: { kind: 'widget.created', widget } })
    const run = { sessionId: event.session_id, runId: event.run_id, input: 'Inspect', text: 'Result', events: [event], phase: 'completed' as const, finishedAt: Date.now(), error: null }
    const props = { conversationKey: event.session_id, run, appTurns: [{ sessionId: event.session_id, runId: event.run_id, input: run.input, events: [event] }], draft: '', onDraft: vi.fn(), send: vi.fn(), disabled: true, available: true, appsAvailable: true, historyConfirmed: true }
    const view = render(<RunPanel {...props} />)
    const proxy = await screen.findByTitle('Controlled App proxy')
    expect(proxy.closest('details')).toBeNull()
    expect(screen.getByText('Last turn snapshot').closest('details')?.open).toBe(false)
    view.rerender(<RunPanel {...props} historyConfirmed={false} run={{ ...run, phase: 'unknown' }} />)
    expect(screen.getByTitle('Controlled App proxy')).toBe(proxy)
    expect(screen.getByText('Execution is unconfirmed. New input is blocked.')).toBeDefined()
  })

  it('keeps the same App frame when the current Run changes and history refreshes', async () => {
    const event = runEventSchema.parse({ session_id: '00000000-0000-4000-8000-000000000001', run_id: '00000000-0000-4000-8000-000000000002', event_id: '00000000-0000-4000-8000-000000000005', sequence: 1, created_at: '2026-10-16T00:00:00Z', event: { kind: 'widget.created', widget } })
    const run = { sessionId: event.session_id, runId: event.run_id, input: 'First input', text: 'Result', events: [event], phase: 'completed' as const, finishedAt: Date.now(), error: null }
    const appTurns = [{ sessionId: event.session_id, runId: event.run_id, input: run.input, events: [event] }]
    const props = { conversationKey: event.session_id, run, appTurns, draft: '', onDraft: vi.fn(), send: vi.fn(), disabled: true, available: true, appsAvailable: true, historyConfirmed: true }
    const view = render(<RunPanel {...props} />)
    const proxy = await screen.findByTitle('Controlled App proxy')
    view.rerender(<RunPanel {...props} historyConfirmed={false} run={{ ...run, runId: '00000000-0000-4000-8000-000000000006', input: 'Second input', events: [], phase: 'streaming', text: '', finishedAt: null }} />)
    expect(screen.getByTitle('Controlled App proxy')).toBe(proxy)
    expect(screen.getByRole('region', { name: `Apps for Run ${event.run_id}` }).textContent).toContain('First input')
    expect(screen.getByRole('region', { name: 'Current Run' }).querySelector('iframe')).toBeNull()
    view.rerender(<RunPanel {...props} historyVersion="new history" run={{ ...run, phase: 'rejected' }} />)
    expect(screen.getByTitle('Controlled App proxy')).toBe(proxy)
  })

  it('scopes input and dismissal by Session/Run and preserves closed Apps across selection changes', async () => {
    const user = userEvent.setup()
    const event = runEventSchema.parse({ session_id: '00000000-0000-4000-8000-000000000001', run_id: '00000000-0000-4000-8000-000000000002', event_id: '00000000-0000-4000-8000-000000000005', sequence: 2, created_at: '2026-10-16T00:00:00Z', event: { kind: 'widget.created', widget } })
    const input = runEventSchema.parse({ ...event, event_id: '00000000-0000-4000-8000-000000000006', sequence: 1, event: { kind: 'tool.started', tool_invocation_id: widget.tool_invocation_id, tool_name: widget.tool_name, arguments: { value: 'first' } } })
    const first = { sessionId: event.session_id, runId: event.run_id, input: 'First input', events: [input, event] }
    const secondRunId = '00000000-0000-4000-8000-000000000007'
    const second = { ...first, runId: secondRunId, input: 'Second input', events: [{ ...input, run_id: secondRunId, event: { ...input.event, arguments: { value: 'second' } } }, { ...event, run_id: secondRunId }] }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<SessionApps turns={[first]} sessionId={event.session_id} available />)
    await screen.findByTitle('Controlled App proxy')
    expect(renderer.props?.toolInput).toEqual({ value: 'first' })
    await user.click(screen.getByRole('button', { name: 'Close App' }))
    view.rerender(<SessionApps turns={[first, second]} sessionId={event.session_id} available />)
    await screen.findByTitle('Controlled App proxy')
    expect(renderer.props?.toolInput).toEqual({ value: 'second' })
    expect(screen.getAllByTitle('Controlled App proxy')).toHaveLength(1)
    expect(screen.getByText('App closed')).toBeDefined()
    view.rerender(<SessionApps turns={[first, second]} sessionId={secondRunId} available />)
    expect(screen.queryByRole('region', { name: 'Session Apps' })).toBeNull()
    expect(screen.queryByTitle('Controlled App proxy')).toBeNull()
    view.rerender(<SessionApps turns={[first]} sessionId={event.session_id} available />)
    expect(screen.getByText('App closed')).toBeDefined()
    expect(screen.queryByTitle('Controlled App proxy')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reload App' }))
    await screen.findByTitle('Controlled App proxy')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('contains a renderer crash without taking down the surrounding conversation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderer.broken = true
    const event = runEventSchema.parse({ session_id: '00000000-0000-4000-8000-000000000001', run_id: '00000000-0000-4000-8000-000000000002', event_id: '00000000-0000-4000-8000-000000000005', sequence: 1, created_at: '2026-10-16T00:00:00Z', event: { kind: 'widget.created', widget } })
    render(<><p>Conversation remains</p><McpApps events={[event]} available /></>)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('App unavailable. The tool result is preserved.'))
    expect(screen.getByText('Conversation remains')).toBeDefined()
  })
})