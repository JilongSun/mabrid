import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  window.history.replaceState(null, '', '/gateway/topology')
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).includes('/sessions?') ? { items: [], next_cursor: null } : String(input).endsWith('/topology') ? { endpoints: [], upstreams: [] } : { published_endpoint_slugs: [] },
  ), { headers: { 'content-type': 'application/json' } })))
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('workspace navigation', () => {
  it('starts on Gateway Topology with only core configuration tabs', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Gateway' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Topology' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Topology', 'Endpoints', 'Upstreams',
    ])
  })

  it('preserves the selected Gateway view when switching workspaces', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Upstreams' }))
    const navigation = within(screen.getByRole('navigation', { name: 'Product navigation' }))
    await user.click(navigation.getByRole('button', { name: 'Agent Host' }))
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    expect(screen.queryByRole('tab', { name: 'Endpoints' })).toBeNull()
    await user.click(navigation.getByRole('button', { name: 'Connection & capabilities' }))
    expect(screen.getByRole('heading', { name: 'Connection & capabilities' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Local readiness' })).toBeDefined()
    await user.click(navigation.getByRole('button', { name: 'Gateway' }))
    expect(screen.getByRole('tab', { name: 'Upstreams' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens diagnostics as a secondary view and returns to the selected Gateway tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Endpoints' }))
    const trigger = screen.getByRole('link', { name: 'Diagnostics' })
    await user.click(trigger)
    const heading = screen.getByRole('heading', { name: 'MCP Session diagnostics' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Session status filter' })).toBeDefined()
    const navigation = within(screen.getByRole('navigation', { name: 'Product navigation' }))
    await user.click(navigation.getByRole('button', { name: 'Agent Host' }))
    await user.click(navigation.getByRole('button', { name: 'Gateway' }))
    expect(screen.getByRole('heading', { name: 'MCP Session diagnostics' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Back to Gateway' }))
    expect(screen.getByRole('tab', { name: 'Endpoints' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('heading', { name: 'MCP Session diagnostics' })).toBeNull()
  })

  it('keeps collapsed navigation named and functional', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Agent Host' }))
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }))
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeDefined()
  })

  it('closes mobile navigation after selection and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(<App />)
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    const dialog = within(screen.getByRole('dialog', { name: 'Mabrid' }))
    await user.click(dialog.getByRole('button', { name: 'Agent Host' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    expect(document.activeElement).toBe(trigger)
  })

  it('supports keyboard switching between Gateway views', async () => {
    const user = userEvent.setup()
    render(<App />)
    screen.getByRole('tab', { name: 'Endpoints' }).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Upstreams' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('heading', { name: 'Upstreams' })).toBeDefined()
  })

  it('returns to the default Gateway when a different workspace URL was opened directly', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/agent-host')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Gateway' }))
    expect(screen.getByRole('tab', { name: 'Topology' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens diagnostics directly and returns to the default Gateway', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/gateway/sessions')
    render(<App />)
    expect(await screen.findByText('No MCP Sessions match these filters')).toBeDefined()
    expect(screen.queryByRole('tablist')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back to Gateway' }))
    expect(screen.getByRole('tab', { name: 'Topology' }).getAttribute('aria-selected')).toBe('true')
  })

  it('returns from the assigned Endpoint to its origin in the capability workspace', async () => {
    const user = userEvent.setup()
    const endpointId = '00000000-0000-4000-8000-000000000001'
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((input, options) => String(input).endsWith('/agent-host/target')
      ? Promise.resolve(new Response(JSON.stringify({ target_id: 'primary', runtime_profile: { integration_kind: 'hermes', interface: 'native', capabilities: [] }, assignment: { endpoint_id: endpointId, endpoint_slug: 'operations', endpoint_path: '/mcp/operations', transport: 'streamable-http', advertised_url: 'https://gateway.example/mcp/operations' } }), { headers: { 'content-type': 'application/json' } }))
      : original(input, options))
    window.history.replaceState(null, '', '/status')
    render(<App />)
    const origin = await screen.findByRole('link', { name: endpointId })
    await user.click(origin)
    expect(window.location.pathname).toBe(`/gateway/endpoints/${endpointId}`)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.pathname).toBe('/status'))
    expect(await screen.findByRole('heading', { name: 'Connection & capabilities' })).toBeDefined()
    await waitFor(() => expect(document.activeElement).toBe(origin))
  })
})
