import { FileSearch, Network } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { Endpoint, GatewaySnapshot, Upstream } from './api'
import { McpAddress } from './endpoints-view'
import type { NavigateGateway } from './gateway-navigation'
import { GatewayLink } from './gateway-link'

function TechnicalInformation({ object, objectId, bindings }: {
  object: Endpoint | Upstream
  objectId: string
  bindings?: Endpoint['bindings']
}) {
  return <details className="mt-8 border-t py-5">
    <summary className="cursor-pointer text-sm font-medium">Technical information</summary>
    <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Object ID</dt><dd className="break-all font-mono text-xs">{objectId}</dd>
      <dt className="text-muted-foreground">Slug</dt><dd className="break-all">{object.slug}</dd>
      <dt className="text-muted-foreground">Revision number</dt><dd>{object.current_revision.revision_number}</dd>
      <dt className="text-muted-foreground">Revision ID</dt><dd className="break-all font-mono text-xs">{object.current_revision.revision_id}</dd>
      <dt className="text-muted-foreground">Created at</dt><dd>{object.current_revision.created_at}</dd>
      <dt className="text-muted-foreground">Metadata</dt><dd><pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5">{JSON.stringify(object.metadata, null, 2)}</pre></dd>
    </dl>
    {bindings && bindings.length > 0 && <div className="mt-5">
      <h4 className="text-sm font-medium">Binding revisions</h4>
      <ul className="mt-3 divide-y">{bindings.map((binding) => <li key={binding.binding_id} className="py-3 text-xs leading-5">
        <p className="break-all">Binding ID: {binding.binding_id}</p>
        <p className="break-all">Binding revision: {binding.binding_revision_id}</p>
        <p className="break-all">Referenced upstream revision: {binding.upstream_revision_id}</p>
      </li>)}</ul>
    </div>}
  </details>
}

function BindingTable({ rows, snapshot, endpointDetail }: {
  rows: { endpoint: Endpoint; binding: Endpoint['bindings'][number] }[]
  snapshot: GatewaySnapshot
  endpointDetail: boolean
}) {
  if (rows.length === 0) return <p className="mt-4 text-sm text-muted-foreground">{endpointDetail ? 'No bindings' : 'Not referenced by an endpoint'}</p>
  const upstreams = new Map(snapshot.topology.upstreams.map((upstream) => [upstream.server_id, upstream]))
  return <div className="mt-4 overflow-x-auto border-y">
    <table className="w-full text-left text-sm" aria-label={endpointDetail ? 'Endpoint bindings' : 'Upstream endpoint bindings'}>
      <thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr>
        <th scope="col" className="px-4 py-3 font-medium">{endpointDetail ? 'Upstream' : 'Endpoint'}</th>
        <th scope="col" className="px-4 py-3 font-medium">Namespace</th>
        <th scope="col" className="px-4 py-3 font-medium">Priority</th>
        <th scope="col" className="px-4 py-3 font-medium">Binding configuration</th>
      </tr></thead>
      <tbody className="divide-y">{rows.map(({ endpoint, binding }) => {
        const upstream = upstreams.get(binding.upstream_server_id)
        return <tr key={binding.binding_id}>
          <td className="max-w-sm px-4 py-4 align-top">
            {endpointDetail ? upstream ? <GatewayLink kind="upstream" objectId={upstream.server_id} id={`detail-upstream-${binding.binding_id}`}>{upstream.display_name}</GatewayLink>
              : <span className="break-all">Unknown upstream ({binding.upstream_server_id})</span>
              : <GatewayLink kind="endpoint" objectId={endpoint.endpoint_id} id={`detail-endpoint-${binding.binding_id}`}>{endpoint.display_name}</GatewayLink>}
            {upstream && !upstream.enabled && <p className="mt-1 text-xs text-muted-foreground">Upstream disabled</p>}
            {!endpoint.enabled && <p className="mt-1 text-xs text-muted-foreground">Endpoint disabled</p>}
            {upstream && upstream.current_revision.revision_id !== binding.upstream_revision_id && <p className="mt-1 text-xs text-muted-foreground">References a different upstream revision</p>}
          </td>
          <td className="max-w-xs break-all px-4 py-4 align-top font-mono text-xs">{binding.namespace ?? 'None'}</td>
          <td className="px-4 py-4 align-top">{binding.priority}</td>
          <td className="px-4 py-4 align-top">{binding.enabled ? 'Enabled' : 'Disabled'}</td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

function ConfiguredKeys({ title, keys }: { title: string; keys: { name: string; configured: true }[] }) {
  return <div className="mt-5">
    <h4 className="text-sm font-medium">{title}</h4>
    {keys.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None configured</p> : <ul className="mt-2 space-y-2 text-sm">{keys.map((key) => <li key={key.name} className="flex flex-wrap gap-x-4 gap-y-1"><code className="break-all text-xs">{key.name}</code><span className="text-xs text-muted-foreground">Configured</span></li>)}</ul>}
  </div>
}

export function EndpointDetails({ endpoint, snapshot, onNavigate }: {
  endpoint: Endpoint; snapshot: GatewaySnapshot; onNavigate: NavigateGateway
}) {
  const location = useLocation()
  const publication = snapshot.publication.kind === 'error' ? 'Publication unknown'
    : snapshot.publication.slugs.includes(endpoint.slug) ? 'Published' : 'Not published'
  return <>
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <span>{endpoint.mode === 'aggregate' ? 'Aggregate' : 'Passthrough'}</span><span>{endpoint.enabled ? 'Enabled' : 'Disabled'}</span><span>{publication}</span>
      <Button id={`endpoint-detail-topology-${endpoint.endpoint_id}`} variant="ghost" size="sm" onClick={() => onNavigate('topology', { kind: 'endpoint', id: endpoint.endpoint_id })}><Network aria-hidden="true" />View in topology</Button>
      <Button variant="ghost" size="sm" asChild><Link id={`endpoint-sessions-${endpoint.endpoint_id}`} to={`/gateway/sessions?${new URLSearchParams({ endpoint_id: endpoint.endpoint_id })}`} state={{
        gatewayReturnTo: location.pathname + location.search, gatewayReturnKey: location.key, focusHeading: true,
      }}><FileSearch aria-hidden="true" />View sessions</Link></Button>
    </div>
    <section className="mt-6 border-t py-5" aria-labelledby="endpoint-connection-title">
      <h3 id="endpoint-connection-title" className="mb-4 text-base font-semibold">MCP connection</h3>
      <div className="max-w-3xl"><McpAddress key={endpoint.advertised_url} endpoint={endpoint} /></div>
      <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs"><dt className="text-muted-foreground">Endpoint path</dt><dd className="break-all font-mono">{endpoint.endpoint_path}</dd></dl>
    </section>
    <section className="mt-2" aria-labelledby="endpoint-bindings-title">
      <h3 id="endpoint-bindings-title" className="text-base font-semibold">Upstream bindings</h3>
      <BindingTable snapshot={snapshot} endpointDetail rows={endpoint.bindings.toSorted((first, second) => first.priority - second.priority).map((binding) => ({ endpoint, binding }))} />
    </section>
    <TechnicalInformation object={endpoint} objectId={endpoint.endpoint_id} bindings={endpoint.bindings} />
  </>
}

export function UpstreamDetails({ upstream, snapshot, onNavigate }: {
  upstream: Upstream; snapshot: GatewaySnapshot; onNavigate: NavigateGateway
}) {
  const { connection } = upstream
  const rows = snapshot.topology.endpoints.flatMap((endpoint) => endpoint.bindings
    .filter((binding) => binding.upstream_server_id === upstream.server_id)
    .toSorted((first, second) => first.priority - second.priority).map((binding) => ({ endpoint, binding })))
  return <>
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <span>{upstream.enabled ? 'Enabled' : 'Disabled'}</span>
      <span>{connection.transport === 'streamable-http' ? 'Streamable HTTP' : connection.transport === 'sse' ? 'SSE' : 'stdio'}</span>
      <Button id={`upstream-detail-topology-${upstream.server_id}`} variant="ghost" size="sm" onClick={() => onNavigate('topology', { kind: 'upstream', id: upstream.server_id })}><Network aria-hidden="true" />View in topology</Button>
    </div>
    <section className="mt-6 border-t py-5" aria-labelledby="upstream-connection-title">
      <h3 id="upstream-connection-title" className="text-base font-semibold">Connection configuration</h3>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        {connection.transport === 'stdio' ? <>
          <dt className="text-muted-foreground">Command</dt><dd className="break-all font-mono text-xs">{connection.command}</dd>
          <dt className="text-muted-foreground">Arguments</dt><dd><pre className="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(connection.args, null, 2)}</pre></dd>
          <dt className="text-muted-foreground">Working directory</dt><dd className="break-all font-mono text-xs">{connection.cwd ?? 'Not configured'}</dd>
        </> : <><dt className="text-muted-foreground">URL</dt><dd className="break-all font-mono text-xs">{connection.url}</dd></>}
        {connection.transport === 'streamable-http' && <><dt className="text-muted-foreground">Timeout</dt><dd>{connection.timeout_seconds} seconds</dd></>}
      </dl>
      <ConfiguredKeys title={connection.transport === 'stdio' ? 'Environment variables' : 'HTTP headers'} keys={connection.transport === 'stdio' ? connection.env : connection.headers} />
    </section>
    <section className="mt-2" aria-labelledby="upstream-bindings-title">
      <h3 id="upstream-bindings-title" className="text-base font-semibold">Endpoint bindings</h3>
      <BindingTable snapshot={snapshot} rows={rows} endpointDetail={false} />
    </section>
    <TechnicalInformation object={upstream} objectId={upstream.server_id} />
  </>
}