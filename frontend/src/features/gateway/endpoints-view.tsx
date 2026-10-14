import { useState } from 'react'
import { Copy, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type Endpoint, type GatewaySnapshot } from './api'
import type { NavigateGateway } from './gateway-navigation'
import { GatewayLink } from './gateway-link'

export function McpAddress({ endpoint }: { endpoint: Endpoint }) {
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function copy() {
    setFeedback(null)
    if (!navigator.clipboard || !endpoint.advertised_url) {
      setFeedback({ kind: 'error', message: 'Clipboard access is unavailable. Select and copy the displayed address.' })
      return
    }
    try {
      await navigator.clipboard.writeText(endpoint.advertised_url)
      setFeedback({ kind: 'success', message: 'Copied.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Copy failed. Select and copy the displayed address.' })
    }
  }

  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-muted-foreground xl:sr-only">MCP address</p>
      {endpoint.advertised_url === null ? (
        <>
          <p className="text-sm text-muted-foreground">Advertised URL not configured</p>
          <code className="mt-1 block break-all text-xs">{endpoint.endpoint_path}</code>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all text-xs leading-5">{endpoint.advertised_url}</code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Copy MCP URL for ${endpoint.display_name}`}
            title="Copy MCP URL"
            onClick={copy}
          >
            <Copy aria-hidden="true" />
          </Button>
        </div>
      )}
      {feedback && (
        <p role={feedback.kind === 'error' ? 'alert' : 'status'} className="mt-2 text-xs">
          {feedback.message}
        </p>
      )}
    </div>
  )
}

export function EndpointsView({ snapshot, query, configuration, onNavigate }: {
  snapshot: GatewaySnapshot
  query: string
  configuration: string
  onNavigate: NavigateGateway
}) {
  const { topology, publication } = snapshot
  const upstreams = new Map(topology.upstreams.map((upstream) => [upstream.server_id, upstream]))
  const endpoints = topology.endpoints.filter((endpoint) => (
    (configuration === 'all' || endpoint.enabled === (configuration === 'enabled')) &&
    [endpoint.display_name, endpoint.slug, endpoint.advertised_url ?? '',
      ...endpoint.bindings.map((binding) => upstreams.get(binding.upstream_server_id)?.display_name ?? '')]
      .some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))
  ))

  return (
    <>
      {endpoints.length === 0 ? (
        <div className="mt-6 border-y px-6 py-14 text-center">
          <p className="font-medium">{topology.endpoints.length === 0 ? 'No endpoints configured' : 'No matching endpoints'}</p>
        </div>
      ) : (
        <div className="mt-6 border-y">
          <div aria-hidden="true" className="hidden grid-cols-[1fr_1fr_0.8fr_1.4fr] gap-6 border-b bg-muted/30 px-5 py-3 text-xs text-muted-foreground xl:grid">
            <span>Endpoint</span><span>Upstreams</span><span>Configuration / publication</span><span>MCP address</span>
          </div>
          <ul aria-label="Gateway endpoints" className="divide-y">
            {endpoints.map((endpoint) => (
              <li key={endpoint.endpoint_id} className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_1.4fr] xl:gap-6">
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words font-medium"><GatewayLink kind="endpoint" objectId={endpoint.endpoint_id} id={`endpoint-${endpoint.endpoint_id}`}>{endpoint.display_name}</GatewayLink></h3>
                    <Button id={`endpoint-topology-${endpoint.endpoint_id}`} variant="ghost" size="icon-sm" aria-label={`Locate ${endpoint.display_name} in topology`} title="View in topology" onClick={() => onNavigate('topology', { kind: 'endpoint', id: endpoint.endpoint_id })}>
                      <Network aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="mt-2 text-xs">{endpoint.mode === 'aggregate' ? 'Aggregate' : 'Passthrough'}</p>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-xs text-muted-foreground xl:sr-only">Upstreams</p>
                  {endpoint.bindings.length === 0 ? <p className="text-sm text-muted-foreground">No bindings</p> : (
                    <ul className="space-y-2">
                      {endpoint.bindings.toSorted((first, second) => first.priority - second.priority).slice(0, 3).map((binding) => {
                        const upstream = upstreams.get(binding.upstream_server_id)
                        return (
                          <li key={binding.binding_id} className="break-words text-sm">
                            {upstream ? (
                              <GatewayLink kind="upstream" objectId={upstream.server_id} id={`endpoint-binding-${binding.binding_id}`}>{upstream.display_name}</GatewayLink>
                            ) : <span className="break-all">Unknown upstream ({binding.upstream_server_id})</span>}
                            {binding.namespace !== null && <span className="ml-2 text-xs text-muted-foreground">{binding.namespace}</span>}
                            {!binding.enabled && <span className="block text-xs text-muted-foreground">Binding disabled</span>}
                            {upstream && !upstream.enabled && <span className="block text-xs text-muted-foreground">Upstream disabled</span>}
                          </li>
                        )
                      })}
                      {endpoint.bindings.length > 3 && <li><button id={`endpoint-more-${endpoint.endpoint_id}`} type="button" className="text-xs underline underline-offset-4" onClick={() => onNavigate('topology', { kind: 'endpoint', id: endpoint.endpoint_id })}>{endpoint.bindings.length - 3} more bindings</button></li>}
                    </ul>
                  )}
                </div>
                <div className="text-sm">
                  <p className="mb-2 text-xs text-muted-foreground xl:sr-only">Configuration / publication</p>
                  <p>{endpoint.enabled ? 'Enabled' : 'Disabled'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {publication.kind === 'error'
                      ? 'Publication unknown'
                      : publication.slugs.includes(endpoint.slug) ? 'Published' : 'Not published'}
                  </p>
                </div>
                <McpAddress key={endpoint.advertised_url} endpoint={endpoint} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
