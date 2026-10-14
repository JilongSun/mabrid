import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadGatewaySnapshot, type Endpoint, type GatewaySnapshot } from './api'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: GatewaySnapshot }
  | { kind: 'error'; message: string }

function McpAddress({ endpoint }: { endpoint: Endpoint }) {
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

export function EndpointsView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    loadGatewaySnapshot(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unable to load Gateway endpoints.',
          })
        }
      },
    )
    return () => controller.abort()
  }, [revision])

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Endpoints</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            MCP connection addresses and the upstreams behind each endpoint.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={state.kind === 'loading'}
          onClick={() => {
            setState({ kind: 'loading' })
            setRevision((value) => value + 1)
          }}
        >
          <RefreshCw aria-hidden="true" className={state.kind === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} />
          Refresh
        </Button>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Read-only configuration. Published means exposed by the current Gateway process, not verified upstream health.
      </p>

      {state.kind === 'loading' && (
        <p role="status" className="mt-6 rounded-lg border p-6 text-sm text-muted-foreground">
          Loading endpoints…
        </p>
      )}
      {state.kind === 'error' && (
        <div role="alert" className="mt-6 rounded-lg border border-destructive/30 p-6">
          <p className="font-medium">Unable to load endpoints</p>
          <p className="mt-2 text-sm">{state.message}</p>
        </div>
      )}
      {state.kind === 'ready' && (
        <EndpointList snapshot={state.data} />
      )}
    </>
  )
}

function EndpointList({ snapshot }: { snapshot: GatewaySnapshot }) {
  const { topology, publication } = snapshot
  const upstreams = new Map(topology.upstreams.map((upstream) => [upstream.server_id, upstream]))

  return (
    <>
      {publication.kind === 'error' && (
        <div role="alert" className="mt-6 rounded-lg border border-destructive/30 p-4 text-sm">
          <p className="font-medium">Publication status unavailable</p>
          <p className="mt-1">{publication.message} Endpoint configuration remains visible.</p>
        </div>
      )}
      {topology.endpoints.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed px-6 py-14 text-center">
          <p className="font-medium">No endpoints configured</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The Gateway returned an empty topology. This v0.1 interface is read-only.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border">
          <div aria-hidden="true" className="hidden grid-cols-[1fr_1fr_0.8fr_1.4fr] gap-6 border-b bg-muted/30 px-5 py-3 text-xs text-muted-foreground xl:grid">
            <span>Endpoint</span><span>Upstreams</span><span>Configuration / publication</span><span>MCP address</span>
          </div>
          <ul aria-label="Gateway endpoints" className="divide-y">
            {topology.endpoints.map((endpoint) => (
              <li key={endpoint.endpoint_id} className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_1.4fr] xl:gap-6">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">{endpoint.display_name}</h3>
                  <p className="mt-1 break-all text-xs text-muted-foreground">{endpoint.slug}</p>
                  <p className="mt-2 text-xs">{endpoint.mode === 'aggregate' ? 'Aggregate' : 'Passthrough'}</p>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-xs text-muted-foreground xl:sr-only">Upstreams</p>
                  {endpoint.bindings.length === 0 ? <p className="text-sm text-muted-foreground">No bindings</p> : (
                    <ul className="space-y-2">
                      {endpoint.bindings.toSorted((a, b) => a.priority - b.priority).map((binding) => {
                        const upstream = upstreams.get(binding.upstream_server_id)
                        return (
                          <li key={binding.binding_id} className="break-words text-sm">
                            <span>{upstream?.display_name ?? `Unknown upstream (${binding.upstream_server_id})`}</span>
                            {binding.namespace !== null && <span className="ml-2 text-xs text-muted-foreground">{binding.namespace}</span>}
                            {!binding.enabled && <span className="block text-xs text-muted-foreground">Binding disabled</span>}
                            {upstream && !upstream.enabled && <span className="block text-xs text-muted-foreground">Upstream disabled</span>}
                          </li>
                        )
                      })}
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
