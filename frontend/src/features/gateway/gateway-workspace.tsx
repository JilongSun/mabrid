import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadGatewaySnapshot, type GatewaySnapshot } from './api'
import { EndpointsView } from './endpoints-view'
import { UpstreamsView } from './upstreams-view'
import { TopologyView } from './topology-view'
import { EndpointDetails, UpstreamDetails } from './gateway-details'
import { useGatewayNavigation, type GatewayView } from './gateway-navigation'
export type { GatewayView, GatewaySelection, NavigateGateway } from './gateway-navigation'

const views = { topology: 'Topology', endpoints: 'Endpoints', upstreams: 'Upstreams' } as const
/** Owns the shared configuration reads, refresh lifecycle, and cross-view selection. */
export function GatewayWorkspace() {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ snapshot: GatewaySnapshot | null; pending: boolean; error: string | null }>({
    snapshot: null, pending: true, error: null,
  })
  const heading = useRef<HTMLHeadingElement>(null)
  const navigation = useGatewayNavigation(heading, state.snapshot !== null)
  const { view, kind, selection, query, configuration } = navigation

  useEffect(() => {
    const controller = new AbortController()
    loadGatewaySnapshot(controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) setState({ snapshot, pending: false, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({
          ...previous, pending: false,
          error: error instanceof Error ? error.message : 'Unable to read Gateway configuration.',
        }))
      },
    )
    return () => controller.abort()
  }, [revision])

  const endpoint = kind === 'endpoint' ? state.snapshot?.topology.endpoints.find((object) => object.endpoint_id === navigation.objectId) : undefined
  const upstream = kind === 'upstream' ? state.snapshot?.topology.upstreams.find((object) => object.server_id === navigation.objectId) : undefined
  const title = !navigation.found ? 'Gateway page not found'
    : kind ? endpoint?.display_name ?? upstream?.display_name ?? (state.snapshot ? `${kind === 'endpoint' ? 'Endpoint' : 'Upstream'} not found` : state.pending ? 'Loading details' : `${kind === 'endpoint' ? 'Endpoint' : 'Upstream'} details`)
      : views[view]

  return (
    <Tabs value={view} onValueChange={(value) => { if (value in views) navigation.selectTab(value as GatewayView) }} className="gap-0">
      <div className="border-b px-4 md:px-8">
        <TabsList aria-label="Gateway views" variant="line" className="mb-1 h-10 gap-4 p-0">
          {Object.entries(views).map(([value, title]) => <TabsTrigger key={value} value={value} className="px-1">{title}</TabsTrigger>)}
        </TabsList>
      </div>
      <TabsContent value={view} className="min-w-0 p-4 pt-8 md:p-8">
        {kind && <Button id="gateway-detail-back" variant="ghost" size="sm" className="mb-5" onClick={navigation.back}><ArrowLeft aria-hidden="true" />{navigation.backLabel}</Button>}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="gateway-view-heading" ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</h2>
          <Button variant="outline" disabled={state.pending} onClick={() => {
            setState((previous) => ({ ...previous, pending: true, error: null }))
            setRevision((previous) => previous + 1)
          }}>
            <RefreshCw aria-hidden="true" className={state.pending ? 'animate-spin motion-reduce:animate-none' : ''} />
            Refresh
          </Button>
        </div>
        {navigation.found && !kind && view !== 'topology' && <div className="mt-5 flex flex-wrap gap-3">
          <input id={`gateway-search-${view}`} type="search" aria-label={`Search ${view}`} placeholder={`Search ${view}`} value={query} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm sm:max-w-sm" onChange={(event) => navigation.changeFilter('q', event.target.value)} />
          <select id={`gateway-configuration-${view}`} aria-label="Configuration filter" value={configuration} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => navigation.changeFilter('configuration', event.target.value)}>
            <option value="all">All configurations</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
          </select>
        </div>}
        {!navigation.found && <Button variant="outline" className="mt-5" onClick={() => navigation.selectTab('topology')}>Back to topology</Button>}
        {state.pending && <p role="status" className="mt-6 text-sm text-muted-foreground">{state.snapshot ? 'Refreshing configuration...' : `Loading ${view}...`}</p>}
        {state.error && <div role="alert" className="mt-6 border-l-2 border-destructive py-2 pl-4 text-sm">
          <p className="font-medium">{state.snapshot ? 'Refresh failed - showing previous configuration' : 'Unable to load Gateway configuration'}</p>
          <p className="mt-1">{state.error}</p>
        </div>}
        {state.snapshot?.publication.kind === 'error' && <div role="alert" className="mt-6 border-l-2 border-destructive py-2 pl-4 text-sm">
          <p className="font-medium">Publication status unavailable</p>
          <p className="mt-1">{state.snapshot.publication.message} Configuration remains visible.</p>
        </div>}
        {state.snapshot && navigation.found && <>
          {endpoint && <EndpointDetails endpoint={endpoint} snapshot={state.snapshot} onNavigate={navigation.selectObject} />}
          {upstream && <UpstreamDetails upstream={upstream} snapshot={state.snapshot} onNavigate={navigation.selectObject} />}
          {kind && !endpoint && !upstream && <p className="mt-5 text-sm text-muted-foreground">This object is not present in the current Gateway configuration.</p>}
          {!kind && view === 'endpoints' && <EndpointsView snapshot={state.snapshot} query={query} configuration={configuration} onNavigate={navigation.selectObject} />}
          {!kind && view === 'upstreams' && <UpstreamsView snapshot={state.snapshot} query={query} configuration={configuration} onNavigate={navigation.selectObject} />}
          {!kind && view === 'topology' && <TopologyView topology={state.snapshot.topology} publication={state.snapshot.publication} selection={selection} onSelect={navigation.selectTopology} onNavigate={navigation.selectObject} />}
        </>}
      </TabsContent>
    </Tabs>
  )
}