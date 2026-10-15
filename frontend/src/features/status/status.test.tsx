import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilitiesSchema, featureKeys, loadCapabilities, loadHealth, loadReadiness, loadTarget, targetSchema } from './api'
import { HttpError } from '@/lib/http'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StatusWorkspace } from './status-workspace'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const feature = { implemented: true, enabled: true, availability: 'unknown', reason: 'remote_unknown', remote_support: null }
const capabilities = {
  gateway: { topology_read: true, session_inspection: true },
  agent_host: { enabled: true, target_id: 'primary', features: Object.fromEntries(featureKeys.map((key) => [key, feature])), native_runtime: { availability: 'unknown', reason: 'discovery_unsupported' } },
}
const target = {
  target_id: 'primary', runtime_profile: { integration_kind: 'hermes', interface: 'native', capabilities: ['session_history'] },
  assignment: { endpoint_id: '00000000-0000-4000-8000-000000000001', endpoint_slug: 'operations', endpoint_path: '/mcp/operations', transport: 'streamable-http', advertised_url: 'https://gateway.example/mcp/operations' },
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn<typeof fetch>()
const responseFor = (input: RequestInfo | URL) => String(input) === '/health' ? json({ status: 'ok' }) : String(input) === '/ready' ? json({ status: 'ready' }) : String(input) === '/api/v1/capabilities' ? json(capabilities) : json(target)
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async (input) => responseFor(input)); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('scrollTo', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('connection and capability reads', () => {
  it('reads four independent endpoints with no-store and caller cancellation', async () => {
    const signal = new AbortController().signal
    fetchMock.mockResolvedValueOnce(json({ status: 'ok' })).mockResolvedValueOnce(json({ status: 'ready' })).mockResolvedValueOnce(json(capabilities)).mockResolvedValueOnce(json(target))
    await loadHealth(signal)
    await loadReadiness(signal)
    await loadCapabilities(signal)
    await loadTarget(signal)
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/health', '/ready', '/api/v1/capabilities', '/api/v1/agent-host/target'])
    for (const [, options] of fetchMock.mock.calls) expect(options).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) })
  })

  it('preserves unknown support and independent disabled or unimplemented feature facts', () => {
    const parsed = capabilitiesSchema.parse(capabilities)
    expect(parsed.agent_host.features.widgets.remote_support).toBeNull()
    expect(parsed.agent_host.native_runtime?.support).toBeUndefined()
    expect(parsed.agent_host.features.widgets.availability).toBe('unknown')
    expect(capabilitiesSchema.safeParse({ ...capabilities, agent_host: { ...capabilities.agent_host, features: { session_list: feature } } }).success).toBe(false)
    expect(targetSchema.parse(target).assignment.advertised_url).toBe('https://gateway.example/mcp/operations')
  })

  it('retains readiness 503 and unconfigured Target 404 as HTTP facts', async () => {
    fetchMock.mockResolvedValueOnce(json({ type: 'about:blank', title: 'Not ready', status: 503, detail: 'Database unavailable', code: 'not_ready' }, 503)).mockResolvedValueOnce(json({}, 404))
    await expect(loadReadiness(new AbortController().signal)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Database unavailable') })
    await expect(loadTarget(new AbortController().signal)).rejects.toBeInstanceOf(HttpError)
  })

  it('covers all frozen feature and support keys and accepts reviewed capability examples', () => {
    const contract = z.object({ openapi: z.object({ components: z.object({ schemas: z.object({
      AgentHostFeatures: z.object({ required: z.array(z.string()) }),
      RuntimeSupport: z.object({ properties: z.record(z.string(), z.unknown()) }),
    }) }) }) }).parse(JSON.parse(readFileSync(resolve('../docs/contracts/v0.1/frontend-contract.json'), 'utf8')))
    expect([...featureKeys].toSorted()).toEqual(contract.openapi.components.schemas.AgentHostFeatures.required.toSorted())
    expect(Object.keys(capabilitiesSchema.shape.agent_host.shape.native_runtime.unwrap().unwrap().shape.support.unwrap().shape).toSorted()).toEqual(Object.keys(contract.openapi.components.schemas.RuntimeSupport.properties).toSorted())
    const examples = z.array(z.object({ schema: z.string(), value: z.unknown() })).parse(JSON.parse(readFileSync(resolve('../docs/contracts/v0.1/examples.json'), 'utf8')))
    const snapshots = examples.filter((example) => example.schema === 'ProductCapabilitiesResponse')
    expect(snapshots.length).toBeGreaterThan(0)
    for (const example of snapshots) expect(capabilitiesSchema.safeParse(example.value).success).toBe(true)
  })
})

describe('connection and capability workspace', () => {
  it('keeps local readiness visible when runtime evidence is unknown and Target is absent', async () => {
    fetchMock.mockImplementation(async (input) => String(input) === '/health' ? json({ status: 'ok' }) : String(input) === '/ready' ? json({ status: 'ready' }) : String(input) === '/api/v1/capabilities' ? json(capabilities) : json({}, 404))
    render(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    expect(await within(screen.getByRole('region', { name: 'Local readiness' })).findByText('Ready')).toBeDefined()
    expect(await within(screen.getByRole('region', { name: 'Native runtime' })).findAllByText('Unknown')).toHaveLength(8)
    expect(await screen.findByText('Target not found')).toBeDefined()
    const widgets = within(screen.getByRole('row', { name: /MCP Apps widgets/ }))
    expect(widgets.getAllByText('Unknown')).toHaveLength(2)
    expect(widgets.getByText('Remote unknown')).toBeDefined()
  })

  it('keeps readiness failures independent of available remote discovery', async () => {
    fetchMock.mockImplementation(async (input) => String(input) === '/ready'
      ? json({ type: 'about:blank', title: 'Not ready', status: 503, detail: 'Publication unavailable', code: 'not_ready' }, 503)
      : String(input) === '/api/v1/capabilities' ? json({ ...capabilities, agent_host: { ...capabilities.agent_host, native_runtime: { availability: 'available', reason: 'discovery_verified', checked_at: '2026-10-15T00:00:00Z', support: { session_create: true, session_history: false } } } })
        : responseFor(input))
    render(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    expect(await within(screen.getByRole('region', { name: 'Local readiness' })).findByText(/Publication unavailable/)).toBeDefined()
    const runtime = within(await screen.findByRole('region', { name: 'Native runtime' }))
    expect(await runtime.findByText('Available')).toBeDefined()
    expect(runtime.getByText('Supported')).toBeDefined()
    expect(runtime.getByText('Unsupported')).toBeDefined()
    expect(runtime.getAllByText('Unknown')).toHaveLength(5)
    expect(within(screen.getByRole('region', { name: 'Local process' })).getByText('ok')).toBeDefined()
  })

  it('retains the previous capability snapshot and timestamp on failed refresh, then retries only that read', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    await screen.findByRole('table', { name: 'Effective Host features' })
    const section = within(screen.getByRole('region', { name: 'Deployment & capabilities' }))
    const timestamp = section.getByText(/Read at/).textContent
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await user.click(section.getByRole('button', { name: 'Refresh Deployment & capabilities' }))
    expect(await section.findByText('Refresh failed - showing previous Deployment & capabilities')).toBeDefined()
    expect(section.getByText(/Read at/).textContent).toBe(timestamp)
    expect(section.getByRole('table', { name: 'Effective Host features' })).toBeDefined()
    await user.click(section.getByRole('button', { name: 'Refresh Deployment & capabilities' }))
    await waitFor(() => expect(section.queryByRole('alert')).toBeNull())
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(['/health', '/ready', '/api/v1/capabilities', '/api/v1/agent-host/target', '/api/v1/capabilities', '/api/v1/capabilities'])
  })

  it('distinguishes disabled deployment, unsupported features and unreported runtime evidence', async () => {
    const disabled = { ...capabilities, agent_host: { enabled: false, target_id: null, features: Object.fromEntries(featureKeys.map((key) => [key, { implemented: key !== 'host_actions', enabled: false, remote_support: null, availability: key === 'host_actions' ? 'unsupported' : 'disabled', reason: key === 'host_actions' ? 'not_implemented' : 'local_disabled' }])) } }
    fetchMock.mockImplementation(async (input) => String(input) === '/api/v1/capabilities' ? json(disabled) : responseFor(input))
    render(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    expect(await within(await screen.findByRole('region', { name: 'Agent Host deployment' })).findByText('Disabled')).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Agent Host deployment' })).getByText('Not configured')).toBeDefined()
    const actions = within(screen.getByRole('row', { name: /Host actions/ }))
    expect(actions.getByText('Unsupported')).toBeDefined()
    expect(actions.getByText('Not implemented')).toBeDefined()
    expect(actions.getByText('Unknown')).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Native runtime' })).getByText('Not reported')).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Local readiness' })).getByText('Ready')).toBeDefined()
  })

  it('does not read while inactive, cancels on exit and ignores late capability results', async () => {
    const signals: AbortSignal[] = []
    let finishOld: (response: Response) => void = () => { throw new Error('Old capability read not started') }
    fetchMock.mockImplementation((input, options) => {
      if (String(input) === '/api/v1/capabilities') {
        if (options?.signal) signals.push(options.signal)
        return new Promise<Response>((resolve) => { finishOld = resolve })
      }
      return Promise.resolve(responseFor(input))
    })
    const view = render(<MemoryRouter><StatusWorkspace active={false} /></MemoryRouter>)
    expect(fetchMock).not.toHaveBeenCalled()
    view.rerender(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    await waitFor(() => expect(signals).toHaveLength(1))
    view.rerender(<MemoryRouter><StatusWorkspace active={false} /></MemoryRouter>)
    expect(signals[0].aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    fetchMock.mockImplementation(async (input) => String(input) === '/api/v1/capabilities' ? json({ ...capabilities, agent_host: { ...capabilities.agent_host, target_id: 'fresh-target' } }) : responseFor(input))
    view.rerender(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    await screen.findByText('fresh-target')
    await act(async () => { finishOld(json(capabilities)) })
    expect(screen.getByText('fresh-target')).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it('isolates malformed capability responses and safely displays the declared Target URL as text', async () => {
    fetchMock.mockImplementation(async (input) => String(input) === '/api/v1/capabilities' ? json({ agent_host: { enabled: true } })
      : String(input) === '/api/v1/agent-host/target' ? json({ ...target, assignment: { ...target.assignment, advertised_url: 'javascript:alert(1)' } }) : responseFor(input))
    render(<MemoryRouter><StatusWorkspace active endpoints={[{ endpoint_id: target.assignment.endpoint_id, display_name: 'Operations' }]} /></MemoryRouter>)
    expect(await screen.findByText('Unable to read Deployment & capabilities')).toBeDefined()
    expect(await screen.findByText('javascript:alert(1)')).toBeDefined()
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Operations' }).getAttribute('href')).toBe(`/gateway/endpoints/${target.assignment.endpoint_id}`)
    expect(within(screen.getByRole('region', { name: 'Local readiness' })).getByText('Ready')).toBeDefined()
  })

  it('refreshes all four reads only on explicit command', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StatusWorkspace active /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh all' }).hasAttribute('disabled')).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await user.click(screen.getByRole('button', { name: 'Refresh all' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh all' }).hasAttribute('disabled')).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })
})