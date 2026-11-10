import type { HeaderOperation, RuntimeFile, RuntimeFileWrite } from './runtime-api'

export type HeaderDraft = { id: string; name: string; existing: boolean; action: 'preserve' | 'replace' | 'remove'; value: string }
export type UpstreamDraft = {
  id: string; key: string; existing: boolean; transport: 'streamable-http' | 'sse' | 'stdio'
  enabled: boolean; url: string; headers: HeaderDraft[]
}
export type EndpointDraft = {
  id: string; key: string; existing: boolean; displayName: string; mode: 'passthrough' | 'aggregate'; enabled: boolean
  bindings: (RuntimeFile['endpoints'][string]['bindings'][number] & { id: string })[]
}
export type RuntimeDraft = { upstreams: UpstreamDraft[]; endpoints: EndpointDraft[] }

export function draftFromFile(file: RuntimeFile): RuntimeDraft {
  return {
    upstreams: Object.entries(file.upstreams).map(([key, upstream]) => ({
      ...upstream, key, id: crypto.randomUUID(), existing: true, url: upstream.url ?? '',
      headers: upstream.headers.map((name) => ({ id: crypto.randomUUID(), name, existing: true, action: 'preserve', value: '' })),
    })),
    endpoints: Object.entries(file.endpoints).map(([key, endpoint]) => ({
      ...endpoint, key, id: crypto.randomUUID(), existing: true, displayName: endpoint.displayName ?? '',
      bindings: endpoint.bindings.map((binding) => ({ ...binding, id: crypto.randomUUID() })),
    })),
  }
}

function uniqueNames(items: { key: string; existing: boolean }[], kind: string) {
  const names = new Set<string>()
  for (const item of items) {
    if (!item.key || !item.existing && !/^[a-z][a-z0-9-]*$/.test(item.key)) throw new Error(`${kind} keys require lowercase letters, digits, or hyphens, starting with a letter.`)
    if (names.has(item.key)) throw new Error(`Duplicate ${kind.toLowerCase()} key: ${item.key}`)
    names.add(item.key)
  }
}

export function writeFromDraft(draft: RuntimeDraft, expectedHash: string | null): RuntimeFileWrite {
  uniqueNames(draft.upstreams, 'Upstream')
  uniqueNames(draft.endpoints, 'Endpoint')
  const upstreams: RuntimeFileWrite['upstreams'] = Object.fromEntries(draft.upstreams.map((upstream) => {
    if (upstream.transport === 'stdio') return [upstream.key, { transport: 'stdio', enabled: upstream.enabled }]
    const url = new URL(upstream.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Upstream URLs must use HTTP or HTTPS.')
    const headers: Record<string, HeaderOperation> = {}
    const names = new Set<string>()
    for (const header of upstream.headers) {
      if (!header.name || /[\r\n]/.test(header.name) || names.has(header.name.toLowerCase())) throw new Error('Header names must be nonempty and unique.')
      names.add(header.name.toLowerCase())
      Object.defineProperty(headers, header.name, { value: header.action === 'replace'
        ? { action: header.action, value: header.value } : { action: header.action }, enumerable: true })
    }
    return [upstream.key, { transport: upstream.transport, enabled: upstream.enabled, url: upstream.url, headers }]
  }))
  const endpoints = Object.fromEntries(draft.endpoints.map((endpoint) => {
    if (!endpoint.bindings.length) throw new Error('Each endpoint requires at least one binding.')
    for (const binding of endpoint.bindings) {
      if (!draft.upstreams.some((upstream) => upstream.key === binding.upstream)) throw new Error('Each binding must select an existing upstream.')
      if (binding.namespace && !/^[a-z][a-z0-9-]*$/.test(binding.namespace)) throw new Error('Namespaces must start with a lowercase letter and use lowercase letters, digits, or hyphens.')
      if (!Number.isInteger(binding.priority)) throw new Error('Binding priority must be an integer.')
    }
    return [endpoint.key, { displayName: endpoint.displayName || null, mode: endpoint.mode, enabled: endpoint.enabled,
      bindings: endpoint.bindings.map(({ upstream, namespace, enabled, priority }) => ({ upstream, namespace: namespace || null, enabled, priority })) }]
  }))
  return { expected_hash: expectedHash, upstreams, endpoints }
}