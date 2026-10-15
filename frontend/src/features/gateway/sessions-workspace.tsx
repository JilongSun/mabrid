import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { Link, matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { GatewayHttpError, type GatewaySnapshot } from './api'
import { GatewayLink } from './gateway-link'
import { useGatewayPagePosition } from './gateway-navigation'
import { loadSession, loadSessionPage, loadSessionSnapshot, sessionPagePath, sessionStatusSchema, type McpSession, type SessionEvent, type SessionSnapshot } from './sessions-api'
import { useSessionEvents } from './use-session-events'

type ReadState<Data> = { data: Data | null; pending: boolean; error: string | null; notFound: boolean; loadedAt: string | null }

function useDiagnosticRead<Data>(key: string | null, load: (key: string, signal: AbortSignal) => Promise<Data>) {
  const [states, setStates] = useState<Record<string, ReadState<Data> & { revision: number }>>({})
  const [request, setRequest] = useState({ key, revision: 0 })
  if (request.key !== key) setRequest({ key, revision: request.revision + 1 })
  const { revision } = request
  const cached = key ? states[key] : undefined
  const state: ReadState<Data> = key ? cached?.revision === revision ? cached : {
    data: cached?.data ?? null, loadedAt: cached?.loadedAt ?? null,
    pending: true, error: null, notFound: false,
  } : { data: null, pending: false, error: null, notFound: false, loadedAt: null }
  useEffect(() => {
    if (!key || request.key !== key) return
    const controller = new AbortController()
    load(key, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setStates((previous) => ({ ...previous, [key]: {
          data, pending: false, error: null, notFound: false, loadedAt: new Date().toISOString(), revision,
        } }))
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setStates((previous) => ({ ...previous, [key]: {
          data: previous[key]?.data ?? null, loadedAt: previous[key]?.loadedAt ?? null, pending: false,
          notFound: error instanceof GatewayHttpError && error.status === 404,
          error: error instanceof Error ? error.message : 'Unable to read Session diagnostics.',
          revision,
        } }))
      },
    )
    return () => controller.abort()
  }, [key, load, request.key, revision])
  return { ...state, refresh: () => setRequest((previous) => ({ key, revision: previous.revision + 1 })) }
}

function ReadFeedback<Data>({ state, label }: { state: ReadState<Data>; label: string }) {
  return <>
    {state.pending && !state.data && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading {label}...</p>}
    {state.error && <div role="alert" className="mt-4 border-l-2 border-destructive py-2 pl-4 text-sm">
      <p className="font-medium">{state.data ? `Refresh failed - showing previous ${label}` : state.notFound ? `${label === 'Session' ? 'Session not found' : 'Snapshot not found'}` : `Unable to load ${label}`}</p>
      <p className="mt-1 break-words">{state.error}</p>
    </div>}
    {state.data && state.loadedAt && <p className="mt-3 text-xs text-muted-foreground">Read at <time dateTime={state.loadedAt}>{state.loadedAt}</time>{state.pending && <span role="status" className="ml-3">Refreshing {label}...</span>}</p>}
  </>
}

function JsonInformation({ label, value }: { label: string; value: unknown }) {
  return <details className="mt-3"><summary className="text-xs font-medium">{label}</summary>
    <pre className="mt-3 whitespace-pre-wrap break-all font-mono text-xs leading-5">{JSON.stringify(value, null, 2)}</pre>
  </details>
}

function SessionInformation({ session, topology }: { session: McpSession; topology: GatewaySnapshot['topology'] | null }) {
  const endpoint = topology?.endpoints.find((object) => object.endpoint_id === session.endpoint_id)
  return <section className="mt-6 border-t py-5" aria-labelledby="session-lifecycle-title">
    <h3 id="session-lifecycle-title" className="text-base font-semibold">Lifecycle</h3>
    <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Status</dt><dd className="break-all">{session.status}</dd>
      <dt className="text-muted-foreground">Endpoint</dt><dd><GatewayLink kind="endpoint" objectId={session.endpoint_id} id="session-endpoint">{endpoint?.display_name ?? session.endpoint_id}</GatewayLink></dd>
      <dt className="text-muted-foreground">Created at</dt><dd className="break-all">{session.created_at}</dd>
      <dt className="text-muted-foreground">Last activity</dt><dd className="break-all">{session.last_activity_at}</dd>
      <dt className="text-muted-foreground">Closed at</dt><dd className="break-all">{session.closed_at ?? 'Not closed'}</dd>
      <dt className="text-muted-foreground">Lifecycle error</dt><dd className="whitespace-pre-wrap break-words">{session.error_message ?? 'None recorded'}</dd>
    </dl>
    {endpoint && endpoint.current_revision.revision_id !== session.endpoint_revision_id && <p className="mt-4 text-sm text-muted-foreground">Captured endpoint revision differs from the current configuration.</p>}
    <details className="mt-5"><summary className="text-sm font-medium">Session identifiers</summary>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Session ID</dt><dd className="break-all font-mono">{session.session_id}</dd>
        <dt className="text-muted-foreground">Endpoint ID</dt><dd className="break-all font-mono">{session.endpoint_id}</dd>
        <dt className="text-muted-foreground">Captured revision</dt><dd className="break-all font-mono">{session.endpoint_revision_id}</dd>
      </dl>
    </details>
  </section>
}

function SnapshotInformation({ snapshot, topology }: { snapshot: SessionSnapshot; topology: GatewaySnapshot['topology'] | null }) {
  return <>
    <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Snapshot status</dt><dd className="break-all">{snapshot.status}</dd>
      <dt className="text-muted-foreground">Updated at</dt><dd className="break-all">{snapshot.updated_at}</dd>
      <dt className="text-muted-foreground">Recorded events</dt><dd>{snapshot.event_count}</dd>
      <dt className="text-muted-foreground">Last observed error</dt><dd className="whitespace-pre-wrap break-words">{snapshot.last_error ?? 'None recorded'}</dd>
    </dl>
    <section className="mt-6 border-t py-5" aria-labelledby="session-initialization-title">
      <h4 id="session-initialization-title" className="text-sm font-semibold">Initialization</h4>
      {snapshot.upstream ? <><dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Server</dt><dd className="break-words">{snapshot.upstream.server_name}</dd>
        <dt className="text-muted-foreground">Server version</dt><dd className="break-all">{snapshot.upstream.server_version ?? 'Not reported'}</dd>
        <dt className="text-muted-foreground">Protocol version</dt><dd>{snapshot.upstream.protocol_version ?? 'Not reported'}</dd>
        <dt className="text-muted-foreground">Tools support</dt><dd>{snapshot.upstream.supports_tools === undefined ? 'Not reported' : snapshot.upstream.supports_tools ? 'Supported' : 'Not supported'}</dd>
        <dt className="text-muted-foreground">Resources support</dt><dd>{snapshot.upstream.supports_resources === undefined ? 'Not reported' : snapshot.upstream.supports_resources ? 'Supported' : 'Not supported'}</dd>
      </dl><JsonInformation label="Reported capabilities" value={snapshot.upstream.raw_capabilities ?? {}} /></> : <p className="mt-3 text-sm text-muted-foreground">No initialization recorded</p>}
    </section>
    <section className="border-t py-5" aria-labelledby="session-upstreams-title">
      <h4 id="session-upstreams-title" className="text-sm font-semibold">Observed upstream availability</h4>
      {snapshot.upstream_availability.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No upstream observations</p> : <ul className="mt-3 divide-y">{snapshot.upstream_availability.map((upstream) => <li key={upstream.binding_revision_id} className="py-4 text-sm">
        <div className="flex flex-wrap justify-between gap-3"><GatewayLink kind="upstream" objectId={upstream.upstream_server_id} id={`session-upstream-${upstream.binding_revision_id}`}>{topology?.upstreams.find((object) => object.server_id === upstream.upstream_server_id)?.display_name ?? upstream.upstream_server_id}</GatewayLink><span className="break-all text-muted-foreground">{upstream.status}</span></div>
        <p className="mt-2 break-all text-xs text-muted-foreground">Namespace: {upstream.namespace ?? 'None'} / Updated: {upstream.updated_at}</p>
        {upstream.identity && <p className="mt-2 break-words text-xs">Observed server: {upstream.identity.server_name}</p>}
        {(upstream.failure_kind || upstream.error_message) && <p className="mt-2 whitespace-pre-wrap break-words text-xs">{upstream.failure_kind}{upstream.failure_kind && upstream.error_message ? ': ' : ''}{upstream.error_message}</p>}
        <JsonInformation label="Observation identifiers and initialization" value={{ binding_revision_id: upstream.binding_revision_id, upstream_revision_id: upstream.upstream_revision_id, upstream_server_id: upstream.upstream_server_id, identity: upstream.identity ?? null }} />
      </li>)}</ul>}
    </section>
    <section className="border-t py-5" aria-labelledby="session-tools-title">
      <h4 id="session-tools-title" className="text-sm font-semibold">Discovered tools ({snapshot.discovered_tools.length})</h4>
      {snapshot.discovered_tools.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No tools recorded</p> : <ul className="mt-3 divide-y">{snapshot.discovered_tools.map((tool) => <li key={tool.name} className="py-4 text-sm">
        <p className="break-all font-mono text-xs">{tool.name}</p>{tool.title && <p className="mt-2 break-words font-medium">{tool.title}</p>}
        {tool.description && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{tool.description}</p>}
        {tool.ui_resource_uri && <p className="mt-2 break-all font-mono text-xs">{tool.ui_resource_uri}</p>}
        <JsonInformation label={`Tool definition: ${tool.name}`} value={{ input_schema: tool.input_schema, output_schema: tool.output_schema, annotations: tool.annotations, metadata: tool.metadata }} />
      </li>)}</ul>}
    </section>
    <section className="border-t py-5" aria-labelledby="session-calls-title">
      <h4 id="session-calls-title" className="text-sm font-semibold">Active tool calls ({snapshot.active_tool_calls.length})</h4>
      {snapshot.active_tool_calls.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No active tool calls</p> : <ul className="mt-3 divide-y">{snapshot.active_tool_calls.map((call) => <li key={call.call_id} className="py-3 text-sm"><p className="break-all">{call.tool_name}</p><p className="mt-2 break-all text-xs text-muted-foreground">{call.status} / Started: {call.started_at}</p><p className="mt-2 break-all font-mono text-xs">{call.call_id}</p></li>)}</ul>}
    </section>
    <section className="border-t py-5" aria-labelledby="session-resources-title">
      <h4 id="session-resources-title" className="text-sm font-semibold">Resource reads ({snapshot.resource_reads.length})</h4>
      {snapshot.resource_reads.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No resource reads recorded</p> : <ul className="mt-3 divide-y">{snapshot.resource_reads.map((resource, index) => <li key={`${resource.requested_uri}-${resource.loaded_at}-${index}`} className="py-3 text-sm"><p className="break-all font-mono text-xs">{resource.requested_uri}</p><p className="mt-2 break-all text-xs text-muted-foreground">{resource.loaded_at} / {resource.contents.length} content items</p></li>)}</ul>}
    </section>
  </>
}

function eventSummary(event: SessionEvent['event'], topology: GatewaySnapshot['topology'] | null): string {
  switch (event.kind) {
    case 'session.started': return event.upstream ? `Session started: ${event.upstream.server_name}` : 'Session started'
    case 'tool.discovered': return `Tool discovered: ${event.tool.name}`
    case 'tool.call.started': return `Tool call started: ${event.call.tool_name} (${event.call.status})`
    case 'tool.call.completed': return `Tool call finished: ${event.call.tool_name} (${event.call.status}${event.call.result?.is_error ? ', tool error' : ''})`
    case 'resource.read': return `Resource read: ${event.read.requested_uri}`
    case 'error.raised': return `Error: ${event.message}`
    case 'upstream.availability.changed': {
      const upstream = topology?.upstreams.find((object) => object.server_id === event.availability.upstream_server_id)
      return `Upstream availability: ${upstream?.display_name ?? event.availability.upstream_server_id} (${event.availability.status})`
    }
  }
}

function SessionEventTimeline({ events, topology, expanded, onToggle }: {
  events: ReturnType<typeof useSessionEvents>
  topology: GatewaySnapshot['topology'] | null
  expanded: Record<string, boolean>
  onToggle: (key: string, open: boolean) => void
}) {
  return <section className="mt-5 border-t py-5" aria-labelledby="session-events-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="session-events-title" className="text-base font-semibold">Event timeline ({events.items.length})</h3>
      <Button id="session-events-refresh" variant="outline" size="sm" disabled={events.pending} onClick={events.refresh}><RefreshCw aria-hidden="true" />Refresh events</Button>
    </div>
    {events.pending && !events.loaded && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading events...</p>}
    {events.error && <div role="alert" className="mt-4 border-l-2 border-destructive py-2 pl-4 text-sm">
      <p className="font-medium">{events.loaded ? 'Unable to read subsequent events - showing previous events' : events.notFound ? 'Session events not found' : 'Unable to load events'}</p>
      <p className="mt-1 break-words">{events.error}</p>
    </div>}
    {events.loadedAt && <p className="mt-3 text-xs text-muted-foreground">Read at <time dateTime={events.loadedAt}>{events.loadedAt}</time>{events.pending && <span role="status" className="ml-3">Reading subsequent events...</span>}</p>}
    {events.loaded && events.items.length === 0 && !events.error && <p className="mt-4 text-sm text-muted-foreground">No events recorded</p>}
    {events.items.length > 0 && <ol aria-label="Session events" className="mt-4 divide-y border-y">{events.items.map((item) => <li key={item.sequence}>
      <details open={expanded[`${item.event.session_id}:${item.sequence}`] ?? false} onToggle={(event) => onToggle(`${item.event.session_id}:${item.sequence}`, event.currentTarget.open)}>
        <summary id={`session-event-${item.event.session_id}-${item.sequence}`} className="break-words py-3 text-sm">
          <span className="mr-3 font-mono text-xs text-muted-foreground">#{item.sequence}</span>
          <span>{eventSummary(item.event, topology)}</span>
          <time dateTime={item.event.created_at} className="ml-3 inline-block break-all text-xs text-muted-foreground">{item.event.created_at}</time>
        </summary>
        <div className="min-w-0 pb-4 pl-4">
          <p className="mb-3 break-all font-mono text-xs text-muted-foreground">{item.event.kind}</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5">{JSON.stringify(item.event, null, 2)}</pre>
        </div>
      </details>
    </li>)}</ol>}
    {events.nextAfter !== null && <Button id="session-events-more" variant="outline" className="mt-4" disabled={events.pending} onClick={events.refresh}>Load more events<ArrowRight aria-hidden="true" /></Button>}
  </section>
}

/** Owns URL-scoped diagnostic reads while preserving cached pages and Gateway return context. */
export function SessionsWorkspace({ topology }: { topology: GatewaySnapshot['topology'] | null }) {
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({})
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const list = Boolean(matchPath('/gateway/sessions', location.pathname))
  const detail = matchPath('/gateway/sessions/:id', location.pathname)
  const sessionId = detail?.params.id
  const active = list || Boolean(detail)
  const endpointId = params.get('endpoint_id') ?? ''
  const status = params.get('status') ?? ''
  const cursor = params.get('cursor') ?? ''
  const validFilters = (!endpointId || z.uuid().safeParse(endpointId).success) && (!status || sessionStatusSchema.safeParse(status).success)
  const validId = Boolean(sessionId && z.uuid().safeParse(sessionId).success)
  const path = sessionPagePath({ endpointId, status, cursor })
  const page = useDiagnosticRead(list && validFilters ? path : null, loadSessionPage)
  const session = useDiagnosticRead(validId ? sessionId! : null, loadSession)
  const snapshot = useDiagnosticRead(validId ? sessionId! : null, loadSessionSnapshot)
  const events = useSessionEvents(validId ? sessionId! : null)
  const heading = useRef<HTMLHeadingElement>(null)
  useGatewayPagePosition(heading, list ? Boolean(page.data) || !page.pending : Boolean(session.data) || !session.pending, active, Boolean(detail))
  const state = location.state
  const returnTo = typeof state?.gatewayReturnTo === 'string' && /^\/gateway\/(topology|endpoints|upstreams)(\/[^/?#]+)?(\?.*)?$/.test(state.gatewayReturnTo)
    ? state.gatewayReturnTo : '/gateway/topology'
  const changeFilter = (name: string, value: string) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    next.delete('cursor')
    if (value) next.set(name, value)
    else next.delete(name)
    return next
  }, { replace: true, state })

  if (!active) return null
  return <section aria-labelledby="diagnostics-title" className="min-w-0 border-t p-4 pt-8 md:p-8">
    <Button id="session-back" variant="ghost" size="sm" className="mb-5" onClick={() => {
      if (detail) {
        if (typeof state?.returnTo === 'string' && matchPath('/gateway/sessions', state.returnTo.split('?')[0])) navigate(-1)
        else navigate('/gateway/sessions', { replace: true, state: { ...state, focusHeading: true } })
      } else navigate(returnTo, { replace: true, state: { restoreKey: state?.gatewayReturnKey } })
    }}><ArrowLeft aria-hidden="true" />{detail ? 'Back to sessions' : 'Back to Gateway'}</Button>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h2 id="diagnostics-title" ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{detail ? 'MCP Session' : 'MCP Session diagnostics'}</h2>
      <Button variant="outline" disabled={list ? page.pending : session.pending || snapshot.pending || events.pending} onClick={() => {
        if (list) page.refresh()
        else { session.refresh(); snapshot.refresh(); events.refresh() }
      }}><RefreshCw aria-hidden="true" />Refresh</Button>
    </div>
    {list ? <>
      <div className="mt-5 flex flex-wrap gap-3">
        <select id="session-endpoint-filter" aria-label="Endpoint filter" value={endpointId} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm sm:max-w-sm" onChange={(event) => changeFilter('endpoint_id', event.target.value)}>
          <option value="">All endpoints</option>
          {endpointId && !topology?.endpoints.some((endpoint) => endpoint.endpoint_id === endpointId) && <option value={endpointId}>{endpointId}</option>}
          {topology?.endpoints.map((endpoint) => <option key={endpoint.endpoint_id} value={endpoint.endpoint_id}>{endpoint.display_name}</option>)}
        </select>
        <select id="session-status-filter" aria-label="Session status filter" value={status} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => changeFilter('status', event.target.value)}>
          <option value="">All lifecycle states</option>{status && !sessionStatusSchema.safeParse(status).success && <option value={status}>{status}</option>}
          {sessionStatusSchema.options.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      {!validFilters && <p role="alert" className="mt-5 text-sm">Invalid Session filters. Select a valid endpoint and lifecycle state.</p>}
      <ReadFeedback state={page} label="Sessions" />
      {page.data && <>
        {page.data.items.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">No MCP Sessions match these filters</p> : <div className="mt-6 overflow-x-auto border-y"><table aria-label="MCP Sessions" className="w-full table-fixed text-left text-sm">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr>{['Session', 'Endpoint', 'Status', 'Created at', 'Last activity'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody className="divide-y">{page.data.items.map((item) => <tr key={item.session_id}>
            <td className="px-4 py-4 align-top"><Link id={`session-${item.session_id}`} to={`/gateway/sessions/${encodeURIComponent(item.session_id)}`} state={{ ...state, returnTo: location.pathname + location.search, focusHeading: true }} className="break-all font-mono text-xs underline-offset-4 hover:underline">{item.session_id}</Link></td>
            <td className="break-words px-4 py-4 align-top">{topology?.endpoints.find((endpoint) => endpoint.endpoint_id === item.endpoint_id)?.display_name ?? <span className="break-all font-mono text-xs">{item.endpoint_id}</span>}</td>
            <td className="break-all px-4 py-4 align-top">{item.status}</td>
            <td className="break-all px-4 py-4 align-top text-xs">{item.created_at}</td><td className="break-all px-4 py-4 align-top text-xs">{item.last_activity_at}</td>
          </tr>)}</tbody>
        </table></div>}
        {page.data.next_cursor && <Button id="sessions-next-page" variant="outline" className="mt-5" disabled={page.pending} onClick={() => setParams((previous) => {
          const next = new URLSearchParams(previous)
          next.set('cursor', page.data!.next_cursor!)
          return next
        }, { state: { ...state, focusHeading: true } })}>Next page<ArrowRight aria-hidden="true" /></Button>}
      </>}
    </> : <>
      {!validId && <p role="alert" className="mt-5 text-sm">Invalid Session ID</p>}
      <ReadFeedback state={session} label="Session" />
      {session.data && <SessionInformation session={session.data} topology={topology} />}
      {validId && <SessionEventTimeline events={events} topology={topology} expanded={expandedEvents} onToggle={(key, open) => setExpandedEvents((previous) => previous[key] === open ? previous : { ...previous, [key]: open })} />}
      {validId && <section className="mt-5 border-t pt-5" aria-labelledby="session-snapshot-title">
        <h3 id="session-snapshot-title" className="text-base font-semibold">Diagnostic snapshot</h3>
        <ReadFeedback state={snapshot} label="Snapshot" />
        {snapshot.data && <SnapshotInformation snapshot={snapshot.data} topology={topology} />}
      </section>}
    </>}
  </section>
}