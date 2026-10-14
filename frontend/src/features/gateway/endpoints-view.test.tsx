import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import { loadGatewaySnapshot, topologySchema } from './api'
import { GatewayWorkspace } from './gateway-workspace'

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const revision = { revision_id: id(20), revision_number: 1, created_at: '2026-10-13T10:00:00Z' }
const endpoint = {
  endpoint_id: id(1), slug: 'tools', display_name: 'Tools', mode: 'aggregate',
  enabled: true, endpoint_path: '/mcp/tools', advertised_url: 'https://gateway.example/mcp/tools',
  metadata: {}, current_revision: revision,
  bindings: [{
    binding_id: id(3), binding_revision_id: id(4), upstream_server_id: id(2),
    upstream_revision_id: id(20), namespace: 'ops', priority: 10, enabled: true,
  }],
}
const topology = {
  advertised_base_url: 'https://gateway.example',
  endpoints: [endpoint],
  upstreams: [{
    server_id: id(2), slug: 'operations', display_name: 'Operations', enabled: true,
    metadata: {}, current_revision: revision,
    connection: { transport: 'streamable-http', url: 'https://upstream.example/mcp', headers: [], timeout_seconds: 30 },
  }],
}
const publication = {
  version: '0.1.0', lifecycle_state: 'running', topology_mode: 'frozen_seeded',
  advertised_base_url: 'https://gateway.example', published_endpoint_count: 1,
  published_endpoint_slugs: ['tools'],
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' },
})

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => json(
    String(input).endsWith('/topology') ? topology : publication,
  ))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Endpoint data boundary', () => {
  it('matches the frozen endpoint mode and presentation field names', () => {
    const frozen: unknown = JSON.parse(readFileSync(
      resolve('../docs/contracts/v0.1/frontend-contract.json'), 'utf8',
    ))
    const schema = z.object({
      openapi: z.object({
        components: z.object({
          schemas: z.record(z.string(), z.object({
            properties: z.record(z.string(), z.unknown()).optional(),
            enum: z.array(z.string()).optional(),
          })),
        }),
      }),
    }).parse(frozen).openapi.components.schemas
    expect(topologySchema.shape.endpoints.element.shape.mode.options.toSorted()).toEqual(schema.EndpointMode.enum?.toSorted())
    for (const [shape, name] of [
      [topologySchema.shape, 'TopologyResponse'],
      [topologySchema.shape.endpoints.element.shape, 'ManagedEndpointResponse'],
      [topologySchema.shape.endpoints.element.shape.bindings.element.shape, 'ManagedEndpointBindingResponse'],
      [topologySchema.shape.upstreams.element.shape, 'ManagedUpstreamResponse'],
    ] as const) {
      expect(Object.keys(shape).every((field) => field in (schema[name].properties ?? {}))).toBe(true)
    }
  })

  it('rejects missing arrays, invalid modes and null publication lists instead of treating them as empty', async () => {
    expect(topologySchema.safeParse({}).success).toBe(false)
    expect(topologySchema.safeParse({
      ...topology, endpoints: [{ ...endpoint, mode: 'unknown' }],
    }).success).toBe(false)
    fetchMock.mockImplementation(async (input) => json(
      String(input).endsWith('/topology') ? topology : { published_endpoint_slugs: null },
    ))
    const snapshot = await loadGatewaySnapshot(new AbortController().signal)
    expect(snapshot.publication.kind).toBe('error')
  })

  it('validates all upstream transports and retains only configured secret key names', () => {
    const parseConnection = (connection: unknown) => topologySchema.parse({
      ...topology, upstreams: [{ ...topology.upstreams[0], connection }],
    }).upstreams[0].connection
    expect(parseConnection({
      transport: 'sse', url: 'https://upstream.example/sse',
      headers: [{ name: 'Authorization', configured: true, value: 'not-for-display' }],
    })).toEqual({
      transport: 'sse', url: 'https://upstream.example/sse',
      headers: [{ name: 'Authorization', configured: true }],
    })
    expect(parseConnection({
      transport: 'stdio', command: 'uvx', args: ['example-server'], cwd: null,
      env: [{ name: 'API_KEY', configured: true }],
    }).transport).toBe('stdio')
    expect(() => parseConnection({ transport: 'unknown' })).toThrow()
  })

  it('reports HTML responses and network failures explicitly', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Not found</html>', {
      status: 404, headers: { 'content-type': 'text/html' },
    }))
    await expect(loadGatewaySnapshot(new AbortController().signal)).rejects.toThrow('non-JSON response')
    fetchMock.mockRejectedValue(new TypeError('Network error'))
    await expect(loadGatewaySnapshot(new AbortController().signal)).rejects.toThrow('Cannot reach the Gateway')
  })

  it('reports malformed JSON and bounded request timeouts explicitly', async () => {
    fetchMock.mockImplementation(async () => new Response('{', {
      headers: { 'content-type': 'application/json' },
    }))
    await expect(loadGatewaySnapshot(new AbortController().signal)).rejects.toThrow('invalid JSON')
    const timeout = AbortSignal.abort(new DOMException('Timeout', 'TimeoutError'))
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout)
    fetchMock.mockRejectedValue(timeout.reason)
    await expect(loadGatewaySnapshot(new AbortController().signal)).rejects.toThrow('timed out')
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000)
  })
})

describe('Endpoints view', () => {
  it('shows loading, then upstream bindings and independent configuration/publication facts', async () => {
    render(<GatewayWorkspace />)
    expect(screen.getByRole('status').textContent).toContain('Loading endpoints')
    expect(await screen.findByRole('heading', { name: 'Tools' })).toBeDefined()
    expect(screen.getByText('Operations')).toBeDefined()
    expect(screen.getByText('ops')).toBeDefined()
    expect(within(screen.getByRole('list', { name: 'Gateway endpoints' })).getByText('Enabled')).toBeDefined()
    expect(screen.getByText('Published')).toBeDefined()
    expect(screen.queryByText('Online')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/gateway/topology', '/api/v1/gateway/status',
    ])
    expect(fetchMock.mock.calls.every(([, options]) => options?.cache === 'no-store')).toBe(true)
  })

  it('never invents an advertised URL and distinguishes disabled configuration from publication', async () => {
    fetchMock.mockImplementation(async (input) => json(String(input).endsWith('/topology') ? {
      ...topology,
      endpoints: [{ ...endpoint, enabled: false, advertised_url: null }],
    } : { ...publication, published_endpoint_slugs: [] }))
    render(<GatewayWorkspace />)
    expect(await screen.findByText('Advertised URL not configured')).toBeDefined()
    expect(screen.getByText('/mcp/tools')).toBeDefined()
    expect(within(screen.getByRole('list', { name: 'Gateway endpoints' })).getByText('Disabled')).toBeDefined()
    expect(screen.getByText('Not published')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Copy MCP URL/ })).toBeNull()
  })

  it('shows a real empty result only after a successful topology response', async () => {
    fetchMock.mockImplementation(async (input) => json(
      String(input).endsWith('/topology') ? { ...topology, endpoints: [] } : publication,
    ))
    render(<GatewayWorkspace />)
    expect(screen.queryByText('No endpoints configured')).toBeNull()
    expect(await screen.findByText('No endpoints configured')).toBeDefined()
  })

  it('keeps topology visible with unknown publication when the status request fails', async () => {
    fetchMock.mockImplementation(async (input) => String(input).endsWith('/topology')
      ? json(topology) : json({
        type: 'urn:mabrid:problem:internal-error', title: 'Internal server error',
        status: 500, detail: 'The management request could not be completed.', code: 'internal_error',
      }, 500))
    render(<GatewayWorkspace />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeDefined()
    expect(screen.getByText('Publication unknown')).toBeDefined()
    expect(screen.queryByText('Not published')).toBeNull()
  })

  it('refreshes after a failed request without presenting failure as an empty topology', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new TypeError('Network error'))
    render(<GatewayWorkspace />)
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the Gateway')
    expect(screen.queryByText('No endpoints configured')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('heading', { name: 'Tools' })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('copies the exact returned URL and explicitly reports clipboard denial', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<GatewayWorkspace />)
    const copy = await screen.findByRole('button', { name: 'Copy MCP URL for Tools' })
    await user.click(copy)
    expect(write).toHaveBeenCalledWith(endpoint.advertised_url)
    expect(screen.getByRole('status').textContent).toBe('Copied.')
    write.mockRejectedValueOnce(new Error('Permission denied'))
    await user.click(copy)
    expect(screen.getByRole('alert').textContent).toContain('Copy failed')
  })

  it('aborts outstanding reads on unmount without displaying cancellation as a failure', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    const { unmount } = render(<GatewayWorkspace />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const signals = fetchMock.mock.calls.map(([, options]) => options?.signal)
    unmount()
    expect(signals.every((signal) => signal?.aborted)).toBe(true)
  })
})

describe('Gateway relationships', () => {
  it('shares configuration reads across tabs and follows links in both directions with focus', async () => {
    const user = userEvent.setup()
    render(<GatewayWorkspace />)
    await user.click(await screen.findByRole('button', { name: 'Operations' }))
    expect(screen.getByRole('tab', { name: 'Upstreams' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Operations' }))
    expect(screen.getByText('https://upstream.example/mcp')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Tools' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Tools' }))
    await user.click(screen.getByRole('tab', { name: 'Topology' }))
    expect(within(screen.getByRole('region', { name: 'Topology diagram' })).getAllByRole('button', { name: 'Select upstream Operations' })).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  })

  it('preserves per-view filters and displays stdio and unreferenced disabled upstreams', async () => {
    fetchMock.mockImplementation(async (input) => json(String(input).endsWith('/topology') ? {
      ...topology, upstreams: [...topology.upstreams, {
        server_id: id(10), slug: 'local', display_name: 'Local server', enabled: false,
        connection: { transport: 'stdio', command: 'uvx', args: [], cwd: null, env: [] },
      }],
    } : publication))
    const user = userEvent.setup()
    render(<GatewayWorkspace />)
    await screen.findByRole('heading', { name: 'Tools' })
    await user.type(screen.getByRole('searchbox', { name: 'Search endpoints' }), 'absent')
    expect(screen.getByText('No matching endpoints')).toBeDefined()
    await user.click(screen.getByRole('tab', { name: 'Upstreams' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search upstreams' }), 'stdio')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Configuration filter' }), 'disabled')
    expect(screen.getByRole('heading', { name: 'Local server' })).toBeDefined()
    expect(screen.getByText('uvx')).toBeDefined()
    expect(screen.getByText('Not referenced by an endpoint')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Operations' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Endpoints' }))
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('absent')
    expect(screen.getByText('No matching endpoints')).toBeDefined()
  })

  it('locates an endpoint in topology and follows the selected relationship back to its upstream', async () => {
    const user = userEvent.setup()
    render(<GatewayWorkspace />)
    await user.click(await screen.findByRole('button', { name: 'Locate Tools in topology' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Topology' }))
    const diagram = within(screen.getByRole('region', { name: 'Topology diagram' }))
    expect(diagram.getByRole('button', { name: 'Select endpoint Tools' }).getAttribute('aria-pressed')).toBe('true')
    const summary = within(screen.getByRole('region', { name: 'Selected topology relationship' }))
    expect(summary.getByText(/Namespace: ops \/ Priority: 10/)).toBeDefined()
    await user.click(summary.getByRole('button', { name: 'Operations' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Operations' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps parallel bindings separately selectable and exposes disabled namespace and priority by keyboard', async () => {
    fetchMock.mockImplementation(async (input) => json(String(input).endsWith('/topology') ? {
      ...topology, endpoints: [{ ...endpoint, bindings: [endpoint.bindings[0], {
        ...endpoint.bindings[0], binding_id: id(7), namespace: 'secondary', priority: 20, enabled: false,
      }] }],
    } : publication))
    const user = userEvent.setup()
    render(<GatewayWorkspace />)
    await screen.findByRole('heading', { name: 'Tools' })
    await user.click(screen.getByRole('tab', { name: 'Topology' }))
    const diagram = within(screen.getByRole('region', { name: 'Topology diagram' }))
    const paths = diagram.getAllByRole('button', { name: /Binding from Tools to Operations/ })
    expect(paths).toHaveLength(2)
    expect(paths[0].getAttribute('d')).not.toBe(paths[1].getAttribute('d'))
    paths[1].focus()
    await user.keyboard(' ')
    expect(paths[1].getAttribute('aria-pressed')).toBe('true')
    const summary = within(screen.getByRole('region', { name: 'Selected topology relationship' }))
    expect(summary.getByText(/Namespace: secondary \/ Priority: 20 \/ Binding disabled/)).toBeDefined()
    await user.click(summary.getByRole('button', { name: 'Clear topology selection' }))
    expect(screen.queryByRole('region', { name: 'Selected topology relationship' })).toBeNull()
  })

  it('keeps the previous shared configuration on refresh failure', async () => {
    const user = userEvent.setup()
    render(<GatewayWorkspace />)
    await screen.findByRole('heading', { name: 'Tools' })
    fetchMock.mockRejectedValue(new TypeError('Network error'))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect((await screen.findByRole('alert')).textContent).toContain('showing previous configuration')
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeDefined()
    await user.click(screen.getByRole('tab', { name: 'Upstreams' }))
    expect(screen.getByRole('heading', { name: 'Operations' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('showing previous configuration')
  })

  it('shows missing upstream references and isolated nodes without fabricating a configuration', async () => {
    fetchMock.mockImplementation(async (input) => json(String(input).endsWith('/topology') ? {
      ...topology, upstreams: [], endpoints: [endpoint, { ...endpoint, endpoint_id: id(11), display_name: 'Isolated endpoint', bindings: [] }],
    } : publication))
    const user = userEvent.setup()
    render(<GatewayWorkspace />)
    await screen.findByRole('heading', { name: 'Tools' })
    await user.click(screen.getByRole('tab', { name: 'Topology' }))
    const diagram = within(screen.getByRole('region', { name: 'Topology diagram' }))
    await user.click(diagram.getByRole('button', { name: 'Select upstream Unknown upstream' }))
    expect(screen.getByText('Missing configuration')).toBeDefined()
    const summary = within(screen.getByRole('region', { name: 'Selected topology relationship' }))
    expect(summary.queryByRole('button', { name: 'View upstream' })).toBeNull()
    await user.click(diagram.getByRole('button', { name: 'Select endpoint Isolated endpoint' }))
    expect(within(screen.getByRole('region', { name: 'Selected topology relationship' })).getByText('No bindings')).toBeDefined()
  })
})
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
