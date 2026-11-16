import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gatewayConfigurationSchema } from './api'
import { GatewayConfigurationControls } from './configuration-controls'

const desiredHash = 'a'.repeat(64)
const nextHash = 'b'.repeat(64)
const pending = {
  generation: 1,
  applied_at: '2026-10-27T12:00:00Z',
  applied_hash: 'c'.repeat(64),
  applied_source: 'runtime_file',
  desired_hash: desiredHash,
  file_hash: desiredHash,
  desired_source: 'runtime_file',
  file_valid: true,
  pending: true,
  error: null,
  restart_required: false,
  host_unavailable: false,
  recovery_required: false,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' },
})
const problem = (status: number, code: string, detail: string) => ({
  type: `urn:mabrid:problem:${code}`, title: 'Configuration error', status, detail, code,
})
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json(pending))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Gateway configuration application', () => {
  it('validates required identity and status fields', () => {
    expect(gatewayConfigurationSchema.safeParse(pending).success).toBe(true)
    expect(gatewayConfigurationSchema.safeParse({ ...pending, desired_hash: 'invalid' }).success).toBe(false)
    expect(gatewayConfigurationSchema.safeParse({ ...pending, generation: 0 }).success).toBe(false)
    expect(gatewayConfigurationSchema.safeParse({ ...pending, host_unavailable: undefined }).success).toBe(false)
    expect(gatewayConfigurationSchema.safeParse({ ...pending, desired_source: 'legacy_file' }).success).toBe(false)
    expect(gatewayConfigurationSchema.safeParse({ ...pending, applied_source: 'legacy_file' }).success).toBe(false)
  })

  it('applies exactly the displayed file hash and refreshes the Gateway once', async () => {
    const user = userEvent.setup()
    const onApplied = vi.fn()
    fetchMock.mockImplementation(async (_input, options) => options?.method === 'POST'
      ? json({ ...pending, generation: 2, applied_hash: desiredHash, pending: false })
      : json(pending))
    render(<GatewayConfigurationControls revision={0} onApplied={onApplied} />)

    expect(await screen.findByText('Changes pending')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Apply file changes' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ expected_hash: desiredHash })
    expect(screen.getByText('Applied')).toBeDefined()
  })

  it('requires an explicit refresh and second click after a conflict', async () => {
    const user = userEvent.setup()
    let reads = 0
    let writes = 0
    fetchMock.mockImplementation(async (_input, options) => {
      if (options?.method === 'POST') {
        writes += 1
        return writes === 1
          ? json(problem(409, 'configuration_conflict', 'File changed.'), 409)
          : json({ ...pending, desired_hash: nextHash, file_hash: nextHash, applied_hash: nextHash, pending: false })
      }
      reads += 1
      return json(reads === 1 ? pending : { ...pending, desired_hash: nextHash, file_hash: nextHash })
    })
    const onApplied = vi.fn()
    render(<GatewayConfigurationControls revision={0} onApplied={onApplied} />)

    await screen.findByText('Changes pending')
    await user.click(screen.getByRole('button', { name: 'Apply file changes' }))
    expect((await screen.findByRole('alert')).textContent).toContain('configuration file changed')
    expect(screen.getByRole('button', { name: 'Apply file changes' }).hasAttribute('disabled')).toBe(true)
    expect(writes).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Refresh configuration' }))
    await waitFor(() => expect(reads).toBe(2))
    await user.click(screen.getByRole('button', { name: 'Apply file changes' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(posts.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { expected_hash: desiredHash }, { expected_hash: nextHash },
    ])
  })

  it('reports static restart needs without blocking Gateway application', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_input, options) => options?.method === 'POST'
      ? json({ ...pending, pending: false, restart_required: true })
      : json({ ...pending, restart_required: true }))
    const onApplied = vi.fn()
    render(<GatewayConfigurationControls revision={0} onApplied={onApplied} />)

    await screen.findByText('Changes pending')
    await user.click(screen.getByRole('button', { name: 'Apply file changes' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
    expect(screen.getByText('A process restart is required to apply static process settings.')).toBeDefined()
  })

  it('reports an invalid file, unavailable Host and restart requirement without applying', async () => {
    fetchMock.mockResolvedValue(json({
      ...pending,
      file_valid: false,
      error: 'Invalid runtime configuration.',
      host_unavailable: true,
      restart_required: true,
    }))
    render(<GatewayConfigurationControls revision={0} onApplied={vi.fn()} />)
    expect(await screen.findByText('Invalid')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('Invalid runtime')
    expect(screen.getByText(/Agent Host is unavailable/)).toBeDefined()
    expect(screen.getByText(/process restart is required/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Apply file changes' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  })

  it('does not retry when an apply response has an unknown outcome', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_input, options) => {
      if (options?.method === 'POST') throw new TypeError('Connection lost')
      return json(pending)
    })
    render(<GatewayConfigurationControls revision={0} onApplied={vi.fn()} />)
    await screen.findByText('Changes pending')
    await user.click(screen.getByRole('button', { name: 'Apply file changes' }))
    expect((await screen.findByRole('alert')).textContent).toContain('outcome is unknown')
    expect(screen.getByRole('button', { name: 'Apply file changes' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('surfaces a failed status read and allows a safe refresh', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(json(pending))
    render(<GatewayConfigurationControls revision={0} onApplied={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the Gateway')
    await user.click(screen.getByRole('button', { name: 'Refresh configuration' }))
    expect(await screen.findByText('Changes pending')).toBeDefined()
  })
})
