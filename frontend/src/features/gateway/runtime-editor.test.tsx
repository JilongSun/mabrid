import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RuntimeConfigurationEditor } from './runtime-editor'
import { draftFromFile, writeFromDraft } from './runtime-draft'
import type { RuntimeFile } from './runtime-api'

const file: RuntimeFile = {
  content_hash: 'a'.repeat(64),
  upstreams: { service: { transport: 'streamable-http', enabled: true, url: 'https://example.test/mcp', headers: ['Authorization'] } },
  endpoints: { entry: { displayName: 'Entry', mode: 'passthrough', enabled: true, bindings: [{ upstream: 'service', namespace: null, priority: 0, enabled: true }] } },
  agent_host: { enabled: false, target_id: null, endpoint_slug: null },
}
const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' } })
const problem = (code: string, detail: string) => ({ type: 'urn:fixture', title: 'Fixture', status: 409, code, detail })
const applied = {
  generation: 2, applied_at: '2026-11-10T00:00:00Z', applied_hash: 'b'.repeat(64), applied_source: 'runtime_file',
  desired_hash: 'b'.repeat(64), file_hash: 'b'.repeat(64), desired_source: 'runtime_file', file_valid: true, pending: false, error: null,
  restart_required: false, host_unavailable: false, recovery_required: false,
}

function renderEditor() {
  const onSaved = vi.fn()
  const onApplied = vi.fn()
  render(<RuntimeConfigurationEditor active onSaved={onSaved} onApplied={onApplied} />)
  return { onSaved, onApplied }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_path, options) => options?.method === 'PUT' ? json({ ...file, content_hash: 'b'.repeat(64) }) : options?.method === 'POST' ? json(applied) : json(file))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset() })

describe('Runtime file editor', () => {
  it('saves write-only header replacements without applying', async () => {
    const user = userEvent.setup()
    const { onSaved, onApplied } = renderEditor()
    await screen.findByLabelText('Upstream key')
    expect((screen.getByLabelText('Upstream key') as HTMLInputElement).readOnly).toBe(true)
    await user.selectOptions(screen.getByLabelText('Value operation'), 'replace')
    await user.type(screen.getByLabelText('New value'), 'fixture-new-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved. Awaiting application.')
    const writes = fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')
    expect(writes).toHaveLength(1)
    const body = JSON.parse(String(writes[0][1]?.body))
    expect(body.expected_hash).toBe(file.content_hash)
    expect(body.upstreams.service.headers.Authorization).toEqual({ action: 'replace', value: 'fixture-new-secret' })
    expect(body.agent_host).toBeUndefined()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect(screen.queryByDisplayValue('fixture-new-secret')).toBeNull()
    expect(onSaved).toHaveBeenCalledOnce()
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('applies exactly the hash returned by saving', async () => {
    const user = userEvent.setup()
    const { onApplied } = renderEditor()
    await screen.findByLabelText('Upstream key')
    await user.type(screen.getByLabelText('URL'), '/updated')
    await user.click(screen.getByRole('button', { name: 'Save and apply' }))
    await screen.findByText('Saved and applied. Active generation 2.')
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ expected_hash: 'b'.repeat(64) })
    expect(onApplied).toHaveBeenCalledOnce()
  })

  it('keeps unsaved input on conflict and requires explicit reload', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_path, options) => options?.method === 'PUT' ? json(problem('configuration_conflict', 'File changed.'), 409) : json(file))
    renderEditor()
    await screen.findByLabelText('Upstream key')
    await user.type(screen.getByLabelText('URL'), '/draft')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain('File changed')
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toContain('/draft')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Reload file' }))
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toContain('/draft')
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Reload file' }))
    await waitFor(() => expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe(file.upstreams.service.url))
  })

  it('does not retry unknown save outcomes or attempt apply', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_path, options) => {
      if (options?.method === 'PUT') throw new TypeError('fixture disconnect')
      return json(file)
    })
    renderEditor()
    await screen.findByLabelText('Upstream key')
    await user.type(screen.getByLabelText('URL'), '/draft')
    await user.click(screen.getByRole('button', { name: 'Save and apply' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Save outcome unknown')
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('reports a saved file separately when application conflicts', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_path, options) => options?.method === 'POST' ? json(problem('configuration_conflict', 'File changed.'), 409) : json(file))
    renderEditor()
    await screen.findByLabelText('Upstream key')
    await user.type(screen.getByLabelText('URL'), '/draft')
    await user.click(screen.getByRole('button', { name: 'Save and apply' }))
    expect((await screen.findByRole('alert')).textContent).toContain('File saved. Application failed: File changed.')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('restricts stdio to enablement and sends no launch fields', async () => {
    const user = userEvent.setup()
    const stdio: RuntimeFile = { ...file, upstreams: { local: { transport: 'stdio', enabled: true, url: null, headers: [] } }, endpoints: {} }
    fetchMock.mockImplementation(async () => json(stdio))
    renderEditor()
    await screen.findByDisplayValue('local')
    expect(screen.queryByRole('button', { name: 'Remove upstream' })).toBeNull()
    expect(screen.queryByLabelText('URL')).toBeNull()
    await user.click(screen.getByLabelText('Enabled'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved. Awaiting application.')
    const write = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(String(write?.[1]?.body)).upstreams.local).toEqual({ transport: 'stdio', enabled: false })
  })

  it('supports empty first-run files and endpoint binding editing', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_path, options) => options?.method === 'PUT' ? json(file) : json({ ...file, content_hash: null, upstreams: {}, endpoints: {} }))
    renderEditor()
    await screen.findByRole('button', { name: 'Add upstream' })
    await user.click(screen.getByRole('button', { name: 'Add upstream' }))
    await user.type(screen.getByLabelText('Upstream key'), 'service')
    await user.type(screen.getByLabelText('URL'), 'https://example.test/mcp')
    await user.click(screen.getByRole('tab', { name: 'Endpoints (0)' }))
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }))
    await user.type(screen.getByLabelText('Endpoint key'), 'entry')
    await user.click(screen.getByRole('button', { name: 'Add binding' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved. Awaiting application.')
    const write = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    const body = JSON.parse(String(write?.[1]?.body))
    expect(body.expected_hash).toBeNull()
    expect(body.endpoints.entry.bindings[0].upstream).toBe('service')
  })

  it('retains the editor draft when it is hidden and shown', async () => {
    const user = userEvent.setup()
    const props = { onSaved: vi.fn(), onApplied: vi.fn() }
    const { rerender } = render(<RuntimeConfigurationEditor active {...props} />)
    await screen.findByLabelText('Upstream key')
    await user.type(screen.getByLabelText('URL'), '/draft')
    rerender(<RuntimeConfigurationEditor active={false} {...props} />)
    rerender(<RuntimeConfigurationEditor active {...props} />)
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toContain('/draft')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

it('validates duplicate keys, URL schemes, empty bindings and header operations before writing', () => {
  const draft = draftFromFile(file)
  expect(writeFromDraft(draft, file.content_hash).upstreams.service).toMatchObject({ headers: { Authorization: { action: 'preserve' } } })
  draft.upstreams.push({ ...draft.upstreams[0], id: 'duplicate' })
  expect(() => writeFromDraft(draft, null)).toThrow('Duplicate')
  draft.upstreams.pop()
  draft.upstreams[0].url = 'file:///fixture'
  expect(() => writeFromDraft(draft, null)).toThrow('HTTP or HTTPS')
  draft.upstreams[0].url = 'https://example.test'
  draft.endpoints[0].bindings = []
  expect(() => writeFromDraft(draft, null)).toThrow('at least one binding')
})