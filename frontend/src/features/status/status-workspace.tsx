import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { HttpError } from '@/lib/http'
import { useGatewayPagePosition } from '@/features/gateway/gateway-navigation'
import { featureKeys, loadCapabilities, loadHealth, loadReadiness, loadTarget, supportKeys, type Capabilities, type RuntimeObservation } from './api'

function useStatusRead<Data>(active: boolean, load: (signal: AbortSignal) => Promise<Data>) {
  const [request, setRequest] = useState({ active, revision: 0 })
  const [cached, setCached] = useState<{ data: Data | null; loadedAt: string | null; error: string | null; status: number | null; revision: number } | null>(null)
  if (request.active !== active) setRequest({ active, revision: request.revision + 1 })
  const pending = active && cached?.revision !== request.revision
  useEffect(() => {
    if (!active || !request.active) return
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setCached({ data, loadedAt: new Date().toISOString(), error: null, status: null, revision: request.revision })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setCached((previous) => ({
          data: previous?.data ?? null, loadedAt: previous?.loadedAt ?? null,
          error: error instanceof Error ? error.message : 'Unable to read status.', status: error instanceof HttpError ? error.status : null, revision: request.revision,
        }))
      },
    )
    return () => controller.abort()
  }, [active, load, request.active, request.revision])
  return {
    data: cached?.data ?? null, loadedAt: cached?.loadedAt ?? null, pending,
    error: pending ? null : cached?.error ?? null, status: pending ? null : cached?.status ?? null,
    refresh: () => setRequest((previous) => ({ active, revision: previous.revision + 1 })),
  }
}

type ReadState = { data: unknown; loadedAt: string | null; pending: boolean; error: string | null; status: number | null; refresh: () => void }

function StatusSection({ id, title, state, children }: { id: string; title: string; state: ReadState; children: ReactNode }) {
  return <section aria-labelledby={id} className="min-w-0 border-t py-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      <Button id={`${id}-refresh`} variant="outline" size="sm" disabled={state.pending} onClick={state.refresh} aria-label={`Refresh ${title}`}><RefreshCw aria-hidden="true" />Refresh</Button>
    </div>
    {state.pending && !state.data && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading {title}...</p>}
    {state.loadedAt && <p className="mt-3 text-xs text-muted-foreground">Read at <time dateTime={state.loadedAt}>{state.loadedAt}</time>{state.pending && <span role="status" className="ml-3">Refreshing {title}...</span>}</p>}
    {state.error && <div role="alert" className="mt-4 border-l-2 border-destructive py-2 pl-4 text-sm">
      <p className="font-medium">{state.data ? `Refresh failed - showing previous ${title}` : id === 'configured-target' && state.status === 404 ? 'Target not found' : `Unable to read ${title}`}</p>
      <p className="mt-1 break-words">{state.error}</p>
    </div>}
    {state.data !== null && <div className="mt-5 min-w-0">{children}</div>}
  </section>
}

const words = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ')
const supportLabel = (value: boolean | null | undefined) => value === true ? 'Supported' : value === false ? 'Unsupported' : 'Unknown'
const featureLabels: Record<typeof featureKeys[number], string> = {
  session_list: 'Session list', session_create: 'Session creation', session_reopen: 'Session reopening', session_history: 'Session history',
  session_streaming: 'Session streaming', run_cancel: 'Run cancellation', run_reconcile: 'Run reconciliation', tool_activity: 'Tool activity',
  widgets: 'MCP Apps widgets', compatibility_streaming: 'Compatibility streaming', host_actions: 'Host actions', event_replay: 'Event replay', remote_session_import: 'Remote Session import',
}

function RuntimeEvidence({ title, observation }: { title: string; observation: RuntimeObservation | null | undefined }) {
  const id = title === 'Native runtime' ? 'native-runtime' : 'compatibility-runtime'
  return <section aria-labelledby={id} className="min-w-0 border-t pt-5">
    <h3 id={id} className="text-sm font-semibold">{title}</h3>
    {!observation ? <p className="mt-3 text-sm text-muted-foreground">Not reported</p> : <>
      <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Availability</dt><dd>{words(observation.availability)}</dd>
        <dt className="text-muted-foreground">Reason</dt><dd className="break-words">{words(observation.reason)}</dd>
        <dt className="text-muted-foreground">Checked at</dt><dd className="break-all">{observation.checked_at ? <time dateTime={observation.checked_at}>{observation.checked_at}</time> : 'Not reported'}</dd>
      </dl>
      <dl className="mt-5 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-[minmax(0,1fr)_8rem]">{supportKeys.map((key) => <div key={key} className="contents"><dt className="break-words text-muted-foreground">{words(key)}</dt><dd>{supportLabel(observation.support?.[key])}</dd></div>)}</dl>
    </>}
  </section>
}

function CapabilityInformation({ data }: { data: Capabilities }) {
  return <>
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="gateway-capabilities"><h3 id="gateway-capabilities" className="text-sm font-semibold">Gateway</h3>
        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_8rem] gap-x-5 gap-y-3 text-sm">{([
          ['Deployment', data.gateway.enabled], ['Topology reading', data.gateway.topology_read], ['Session inspection', data.gateway.session_inspection],
          ['Topology mutation', data.gateway.topology_mutation], ['MCP Apps protocol passthrough', data.gateway.mcp_apps_protocol_passthrough],
        ] as const).map(([label, enabled]) => <div key={label} className="contents"><dt className="break-words text-muted-foreground">{label}</dt><dd>{enabled ? 'Enabled' : 'Disabled'}</dd></div>)}</dl>
      </section>
      <section aria-labelledby="host-deployment"><h3 id="host-deployment" className="text-sm font-semibold">Agent Host deployment</h3>
        <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Deployment</dt><dd>{data.agent_host.enabled ? 'Enabled' : 'Disabled'}</dd>
          <dt className="text-muted-foreground">Target</dt><dd className="break-all">{data.agent_host.target_id ?? 'Not configured'}</dd>
          <dt className="text-muted-foreground">Maximum concurrent Runs</dt><dd>{data.agent_host.max_concurrent_runs}</dd>
        </dl>
      </section>
    </div>
    <section aria-labelledby="effective-features" className="mt-6 border-t pt-5"><h3 id="effective-features" className="text-sm font-semibold">Effective Host features</h3>
      <div className="mt-4 overflow-x-auto border-y"><table aria-label="Effective Host features" className="w-full min-w-[44rem] table-fixed text-left text-xs">
        <thead className="border-b bg-muted/30 text-muted-foreground"><tr>{['Feature', 'Implemented', 'Enabled', 'Remote support', 'Availability', 'Reason'].map((label) => <th key={label} scope="col" className="break-words px-3 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y">{featureKeys.map((key) => {
          const feature = data.agent_host.features[key]
          return <tr key={key}><th scope="row" className="break-words px-3 py-3 align-top font-medium">{featureLabels[key]}</th>
            <td className="px-3 py-3 align-top">{feature.implemented ? 'Yes' : 'No'}</td><td className="px-3 py-3 align-top">{feature.enabled ? 'Yes' : 'No'}</td>
            <td className="px-3 py-3 align-top">{supportLabel(feature.remote_support)}</td><td className="break-words px-3 py-3 align-top">{words(feature.availability)}</td><td className="break-words px-3 py-3 align-top">{words(feature.reason)}</td>
          </tr>
        })}</tbody>
      </table></div>
    </section>
    <div className="mt-6 grid gap-6 xl:grid-cols-2"><RuntimeEvidence title="Native runtime" observation={data.agent_host.native_runtime} /><RuntimeEvidence title="Compatibility runtime" observation={data.agent_host.compatibility_runtime} /></div>
  </>
}

/** Owns independent, cancellable status reads; capability facts never authorize a Run. */
export function StatusWorkspace({ active, endpoints = [] }: { active: boolean; endpoints?: { endpoint_id: string; display_name: string }[] }) {
  const health = useStatusRead(active, loadHealth)
  const readiness = useStatusRead(active, loadReadiness)
  const capabilities = useStatusRead(active, loadCapabilities)
  const target = useStatusRead(active, loadTarget)
  const heading = useRef<HTMLHeadingElement>(null)
  useGatewayPagePosition(heading, Boolean(health.data) || !health.pending, active, true)
  return <section aria-labelledby="status-title" className="min-w-0 p-4 pt-8 md:p-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 id="status-title" ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">Connection & capabilities</h1>
      <Button variant="outline" disabled={health.pending || readiness.pending || capabilities.pending || target.pending} onClick={() => { health.refresh(); readiness.refresh(); capabilities.refresh(); target.refresh() }}><RefreshCw aria-hidden="true" />Refresh all</Button>
    </header>
    <div className="grid gap-x-8 xl:grid-cols-2">
      <StatusSection id="local-process" title="Local process" state={health}><dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">{Object.entries(health.data ?? {}).map(([key, value]) => <div key={key} className="contents"><dt className="break-words text-muted-foreground">{words(key)}</dt><dd className="break-all">{value}</dd></div>)}</dl></StatusSection>
      <StatusSection id="local-readiness" title="Local readiness" state={readiness}><p className="text-sm">{readiness.data ? words(readiness.data.status) : null}</p></StatusSection>
    </div>
    <StatusSection id="deployment-capabilities" title="Deployment & capabilities" state={capabilities}>{capabilities.data && <CapabilityInformation data={capabilities.data} />}</StatusSection>
    <StatusSection id="configured-target" title="Configured Target" state={target}>{target.data && <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Target</dt><dd className="break-all">{target.data.target_id}</dd>
      <dt className="text-muted-foreground">Integration</dt><dd className="break-words">{target.data.runtime_profile.integration_kind}</dd>
      <dt className="text-muted-foreground">Interface</dt><dd className="break-words">{target.data.runtime_profile.interface}</dd>
      <dt className="text-muted-foreground">Local runtime capabilities</dt><dd>{target.data.runtime_profile.capabilities.length ? <ul className="space-y-2">{target.data.runtime_profile.capabilities.map((name) => <li key={name} className="break-words">{words(name)}</li>)}</ul> : 'None declared'}</dd>
      <dt className="text-muted-foreground">Assigned Endpoint</dt><dd><Link id="target-endpoint" to={`/gateway/endpoints/${encodeURIComponent(target.data.assignment.endpoint_id)}`} state={{ returnTo: '/status', focusHeading: true }} className="break-all underline-offset-4 hover:underline">{endpoints.find((endpoint) => endpoint.endpoint_id === target.data?.assignment.endpoint_id)?.display_name ?? target.data.assignment.endpoint_id}</Link></dd>
      <dt className="text-muted-foreground">Endpoint slug</dt><dd className="break-all font-mono text-xs">{target.data.assignment.endpoint_slug}</dd>
      <dt className="text-muted-foreground">Transport</dt><dd>{target.data.assignment.transport}</dd>
      <dt className="text-muted-foreground">Endpoint path</dt><dd className="break-all font-mono text-xs">{target.data.assignment.endpoint_path}</dd>
      <dt className="text-muted-foreground">Declared advertised URL</dt><dd className="break-all font-mono text-xs">{target.data.assignment.advertised_url}</dd>
    </dl>}</StatusSection>
  </section>
}