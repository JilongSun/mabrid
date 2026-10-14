import { ArrowRight, List, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GatewaySnapshot } from './api'
import type { GatewaySelection, NavigateGateway } from './gateway-workspace'

type Topology = GatewaySnapshot['topology']

export function TopologyView({ topology, selection, onSelect, onNavigate }: {
  topology: Topology
  selection: GatewaySelection | null
  onSelect: (selection: GatewaySelection | null) => void
  onNavigate: NavigateGateway
}) {
  const upstreams = topology.upstreams.map((upstream) => ({
    id: upstream.server_id, name: upstream.display_name, slug: upstream.slug, enabled: upstream.enabled, missing: false,
  }))
  const edges = topology.endpoints.flatMap((endpoint) => endpoint.bindings.toSorted((first, second) => first.priority - second.priority).map((binding) => ({ endpoint, binding })))
  for (const { binding } of edges) {
    if (!upstreams.some((upstream) => upstream.id === binding.upstream_server_id)) upstreams.push({
      id: binding.upstream_server_id, name: 'Unknown upstream', slug: binding.upstream_server_id, enabled: false, missing: true,
    })
  }
  const selectedEndpoint = topology.endpoints.find((endpoint) => selection?.kind === 'endpoint' && selection.id === endpoint.endpoint_id)
  const selectedUpstream = upstreams.find((upstream) => selection?.kind === 'upstream' && selection.id === upstream.id)
  const selectedBinding = edges.find(({ binding }) => selection?.kind === 'binding' && selection.id === binding.binding_id)
  const hasSelection = Boolean(selectedEndpoint || selectedUpstream || selectedBinding)
  const related = edges.filter(({ endpoint, binding }) => (
    endpoint.endpoint_id === selectedEndpoint?.endpoint_id || binding.upstream_server_id === selectedUpstream?.id || binding.binding_id === selectedBinding?.binding.binding_id
  ))
  const activeEndpoints = new Set(related.map(({ endpoint }) => endpoint.endpoint_id))
  const activeUpstreams = new Set(related.map(({ binding }) => binding.upstream_server_id))
  if (selectedEndpoint) activeEndpoints.add(selectedEndpoint.endpoint_id)
  if (selectedUpstream) activeUpstreams.add(selectedUpstream.id)
  const height = Math.max(topology.endpoints.length, upstreams.length) * 112 + 16
  const toggle = (target: GatewaySelection) => onSelect(selection?.kind === target.kind && selection.id === target.id ? null : target)
  const bindingLabel = (endpointName: string, upstreamName: string, bindingId: string) => `Binding from ${endpointName} to ${upstreamName} (${bindingId})`

  if (topology.endpoints.length === 0 && upstreams.length === 0) return <p className="mt-6 border-y py-14 text-center font-medium">No topology configured</p>

  return <>
    <p className="mt-5 text-xs text-muted-foreground">{topology.endpoints.length} endpoints / {topology.upstreams.length} upstreams / {edges.length} bindings</p>
    <div className="mt-6 hidden md:block" role="region" aria-label="Topology diagram">
      <div className="grid grid-cols-[38%_24%_38%] border-b pb-3 text-xs text-muted-foreground"><span>Endpoints</span><span className="text-center">Bindings</span><span>Upstreams</span></div>
      <div className="relative" style={{ height }}>
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-label="Configured bindings">
          {edges.map(({ endpoint, binding }) => {
            const endpointIndex = topology.endpoints.indexOf(endpoint)
            const upstreamIndex = upstreams.findIndex((upstream) => upstream.id === binding.upstream_server_id)
            const start = endpointIndex * 112 + 56
            const end = upstreamIndex * 112 + 56
            const active = related.some((edge) => edge.binding.binding_id === binding.binding_id)
            const label = bindingLabel(endpoint.display_name, upstreams[upstreamIndex].name, binding.binding_id)
            const parallel = edges.filter((edge) => edge.endpoint.endpoint_id === endpoint.endpoint_id && edge.binding.upstream_server_id === binding.upstream_server_id)
            const offset = (parallel.findIndex((edge) => edge.binding.binding_id === binding.binding_id) - (parallel.length - 1) / 2) * 24
            const path = `M 38 ${start} C 50 ${start + offset}, 50 ${end + offset}, 62 ${end}`
            return <g key={binding.binding_id} opacity={hasSelection && !active ? 0.25 : 1}>
              <path d={path} fill="none" stroke={active ? 'var(--primary)' : 'var(--muted-foreground)'} strokeWidth={active ? 2 : 1} strokeDasharray={binding.enabled ? undefined : '5 4'} vectorEffect="non-scaling-stroke" />
              <path role="button" tabIndex={0} aria-label={label} aria-pressed={selection?.kind === 'binding' && selection.id === binding.binding_id} d={path} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" className="cursor-pointer focus:stroke-ring/50" onClick={() => toggle({ kind: 'binding', id: binding.binding_id })} onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle({ kind: 'binding', id: binding.binding_id }) }
              }}><title>{label}</title></path>
            </g>
          })}
        </svg>
        {topology.endpoints.map((endpoint, index) => <button key={endpoint.endpoint_id} type="button" aria-label={`Select endpoint ${endpoint.display_name}`} aria-pressed={selection?.kind === 'endpoint' && selection.id === endpoint.endpoint_id} onClick={() => toggle({ kind: 'endpoint', id: endpoint.endpoint_id })} style={{ top: index * 112 + 16, width: '38%', height: 80 }} className={`absolute left-0 flex flex-col justify-center rounded-md border bg-background px-3 text-left focus-visible:outline-ring ${hasSelection && !activeEndpoints.has(endpoint.endpoint_id) ? 'opacity-40' : ''} ${activeEndpoints.has(endpoint.endpoint_id) ? 'border-primary bg-accent' : ''}`}>
          <span className="line-clamp-2 w-full break-words text-sm font-medium">{endpoint.display_name}</span><span className="mt-1 text-xs text-muted-foreground">{endpoint.mode === 'aggregate' ? 'Aggregate' : 'Passthrough'} / {endpoint.enabled ? 'Enabled' : 'Disabled'}</span>
        </button>)}
        {upstreams.map((upstream, index) => <button key={upstream.id} type="button" aria-label={`Select upstream ${upstream.name}`} aria-pressed={selection?.kind === 'upstream' && selection.id === upstream.id} onClick={() => toggle({ kind: 'upstream', id: upstream.id })} style={{ top: index * 112 + 16, width: '38%', height: 80 }} className={`absolute right-0 flex flex-col justify-center rounded-md border bg-background px-3 text-left focus-visible:outline-ring ${hasSelection && !activeUpstreams.has(upstream.id) ? 'opacity-40' : ''} ${activeUpstreams.has(upstream.id) ? 'border-primary bg-accent' : ''}`}>
          <span className="line-clamp-2 w-full break-words text-sm font-medium">{upstream.name}</span><span className="mt-1 text-xs text-muted-foreground">{upstream.missing ? 'Missing configuration' : upstream.enabled ? 'Enabled' : 'Disabled'}</span>
        </button>)}
      </div>
    </div>
    <div className="mt-6 divide-y border-y md:hidden" role="region" aria-label="Grouped topology">
      {topology.endpoints.map((endpoint) => <section key={endpoint.endpoint_id} className={`py-4 ${hasSelection && !activeEndpoints.has(endpoint.endpoint_id) ? 'opacity-40' : ''}`}>
        <button type="button" className="max-w-full break-words text-left font-medium underline-offset-4 hover:underline" aria-pressed={selection?.kind === 'endpoint' && selection.id === endpoint.endpoint_id} onClick={() => toggle({ kind: 'endpoint', id: endpoint.endpoint_id })}>{endpoint.display_name}</button>
        <p className="mt-1 text-xs text-muted-foreground">{endpoint.enabled ? 'Enabled' : 'Disabled'} / {endpoint.mode}</p>
        {endpoint.bindings.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No bindings</p> : <ul className="mt-3 space-y-2">{endpoint.bindings.map((binding) => <li key={binding.binding_id}>
          <button type="button" className={`flex w-full items-start gap-2 rounded-md border p-3 text-left text-sm focus-visible:outline-ring ${related.some((edge) => edge.binding.binding_id === binding.binding_id) ? 'border-primary bg-accent' : ''}`} aria-pressed={selection?.kind === 'binding' && selection.id === binding.binding_id} onClick={() => toggle({ kind: 'binding', id: binding.binding_id })}>
            <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{upstreams.find((upstream) => upstream.id === binding.upstream_server_id)?.name}<span className="mt-1 block text-xs text-muted-foreground">{binding.namespace ?? 'No namespace'} / {binding.enabled ? 'Binding enabled' : 'Binding disabled'}</span></span>
          </button>
        </li>)}</ul>}
      </section>)}
      {upstreams.filter((upstream) => !edges.some(({ binding }) => binding.upstream_server_id === upstream.id)).map((upstream) => <section key={upstream.id} className="py-4">
        <button type="button" className="max-w-full break-words text-left font-medium" aria-pressed={selection?.kind === 'upstream' && selection.id === upstream.id} onClick={() => toggle({ kind: 'upstream', id: upstream.id })}>{upstream.name}</button><p className="mt-1 text-xs text-muted-foreground">Not referenced by an endpoint</p>
      </section>)}
    </div>
    {selection && !hasSelection && <p role="status" className="mt-4 text-sm text-muted-foreground">The selected configuration is no longer present.</p>}
    {hasSelection && <section aria-label="Selected topology relationship" className="mt-4 border-t py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium">{selectedEndpoint?.display_name ?? selectedUpstream?.name ?? 'Selected binding'}</h3>
        <Button size="icon-sm" variant="ghost" aria-label="Clear topology selection" title="Clear selection" onClick={() => onSelect(null)}><X aria-hidden="true" /></Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {selectedEndpoint && <Button variant="outline" size="sm" onClick={() => onNavigate('endpoints', { kind: 'endpoint', id: selectedEndpoint.endpoint_id })}><List aria-hidden="true" />View endpoint</Button>}
        {selectedUpstream && !selectedUpstream.missing && <Button variant="outline" size="sm" onClick={() => onNavigate('upstreams', { kind: 'upstream', id: selectedUpstream.id })}><List aria-hidden="true" />View upstream</Button>}
      </div>
      {related.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No bindings</p> : <ul className="mt-3 divide-y">{related.map(({ endpoint, binding }) => <li key={binding.binding_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm">
        <button type="button" className="max-w-full break-words text-left underline underline-offset-4" onClick={() => onNavigate('endpoints', { kind: 'endpoint', id: endpoint.endpoint_id })}>{endpoint.display_name}</button>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        {topology.upstreams.some((upstream) => upstream.server_id === binding.upstream_server_id) ? <button type="button" className="max-w-full break-words text-left underline underline-offset-4" onClick={() => onNavigate('upstreams', { kind: 'upstream', id: binding.upstream_server_id })}>{upstreams.find((upstream) => upstream.id === binding.upstream_server_id)?.name}</button> : <span className="break-all">Unknown upstream ({binding.upstream_server_id})</span>}
        <span className="max-w-full break-words text-xs text-muted-foreground">Namespace: {binding.namespace ?? 'None'} / Priority: {binding.priority} / {binding.enabled ? 'Binding enabled' : 'Binding disabled'}</span>
      </li>)}</ul>}
    </section>}
  </>
}