import { useEffect, useRef } from 'react'
import { Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GatewaySnapshot } from './api'
import type { NavigateGateway } from './gateway-workspace'

export function UpstreamsView({ snapshot, query, configuration, selectedId, onNavigate }: {
  snapshot: GatewaySnapshot
  query: string
  configuration: string
  selectedId?: string
  onNavigate: NavigateGateway
}) {
  const { topology } = snapshot
  const selectedHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    selectedHeading.current?.focus()
    selectedHeading.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])
  const upstreams = topology.upstreams.filter((upstream) => (
    (configuration === 'all' || upstream.enabled === (configuration === 'enabled')) &&
    [upstream.display_name, upstream.slug, upstream.connection.transport,
      upstream.connection.transport === 'stdio' ? upstream.connection.command : upstream.connection.url]
      .some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))
  ))

  if (upstreams.length === 0) return <p className="mt-6 border-y px-6 py-14 text-center font-medium">{topology.upstreams.length === 0 ? 'No upstreams configured' : 'No matching upstreams'}</p>

  return (
    <div className="mt-6 border-y">
      <div aria-hidden="true" className="hidden grid-cols-[1fr_1.2fr_0.6fr_1fr] gap-6 border-b bg-muted/30 px-5 py-3 text-xs text-muted-foreground xl:grid">
        <span>Upstream</span><span>Transport / target</span><span>Configuration</span><span>Endpoint bindings</span>
      </div>
      <ul aria-label="Gateway upstreams" className="divide-y">
        {upstreams.map((upstream) => {
          const endpoints = topology.endpoints.filter((endpoint) => endpoint.bindings.some((binding) => binding.upstream_server_id === upstream.server_id))
          return <li key={upstream.server_id} className={`grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-[1fr_1.2fr_0.6fr_1fr] xl:gap-6 ${selectedId === upstream.server_id ? 'bg-accent/50' : ''}`}>
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 ref={selectedId === upstream.server_id ? selectedHeading : undefined} tabIndex={-1} className="min-w-0 break-words font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{upstream.display_name}</h3>
                <Button variant="ghost" size="icon-sm" title="View in topology" aria-label={`Locate ${upstream.display_name} in topology`} onClick={() => onNavigate('topology', { kind: 'upstream', id: upstream.server_id })}><Network aria-hidden="true" /></Button>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{upstream.slug}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm">{upstream.connection.transport === 'streamable-http' ? 'Streamable HTTP' : upstream.connection.transport === 'sse' ? 'SSE' : 'stdio'}</p>
              <code className="mt-2 block break-all text-xs leading-5">{upstream.connection.transport === 'stdio' ? upstream.connection.command : upstream.connection.url}</code>
            </div>
            <div className="text-sm"><p className="mb-2 text-xs text-muted-foreground xl:sr-only">Configuration</p>{upstream.enabled ? 'Enabled' : 'Disabled'}</div>
            <div className="min-w-0 text-sm">
              <p className="mb-2 text-xs text-muted-foreground xl:sr-only">Endpoint bindings</p>
              {endpoints.length === 0 ? <span className="text-muted-foreground">Not referenced by an endpoint</span> : <ul className="space-y-2">{endpoints.slice(0, 3).map((endpoint) => {
                const bindings = endpoint.bindings.filter((binding) => binding.upstream_server_id === upstream.server_id)
                return <li key={endpoint.endpoint_id} className="break-words">
                  <button type="button" className="max-w-full break-words text-left underline-offset-4 hover:underline focus-visible:outline-ring" onClick={() => onNavigate('endpoints', { kind: 'endpoint', id: endpoint.endpoint_id })}>{endpoint.display_name}</button>
                  <p className="text-xs text-muted-foreground">{bindings.length} {bindings.length === 1 ? 'binding' : 'bindings'}{bindings.every((binding) => !binding.enabled) ? ' (disabled)' : ''}</p>
                </li>
              })}{endpoints.length > 3 && <li><button type="button" className="text-xs underline underline-offset-4" onClick={() => onNavigate('topology', { kind: 'upstream', id: upstream.server_id })}>{endpoints.length - 3} more endpoints</button></li>}</ul>}
            </div>
          </li>
        })}
      </ul>
    </div>
  )
}