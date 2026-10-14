import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadGatewaySnapshot, type GatewaySnapshot } from './api'
import { EndpointsView } from './endpoints-view'
import { UpstreamsView } from './upstreams-view'
import { TopologyView } from './topology-view'

export type GatewayView = 'endpoints' | 'upstreams' | 'topology'
export type GatewaySelection = { kind: 'endpoint' | 'upstream' | 'binding'; id: string }
export type NavigateGateway = (view: GatewayView, selection: GatewaySelection) => void

const views = { topology: 'Topology', endpoints: 'Endpoints', upstreams: 'Upstreams' } as const
const initialFilters = { query: '', configuration: 'all' }

/** Owns the shared configuration reads, refresh lifecycle, and cross-view selection. */
export function GatewayWorkspace() {
  const [view, setView] = useState<GatewayView>('topology')
  const [selection, setSelection] = useState<GatewaySelection | null>(null)
  const [filters, setFilters] = useState({ endpoints: initialFilters, upstreams: initialFilters })
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ snapshot: GatewaySnapshot | null; pending: boolean; error: string | null }>({
    snapshot: null, pending: true, error: null,
  })
  const heading = useRef<HTMLHeadingElement>(null)
  const focusTopology = useRef(false)

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

  useEffect(() => {
    if (focusTopology.current && view === 'topology') {
      heading.current?.focus()
      focusTopology.current = false
    }
  }, [selection, view])

  const navigate: NavigateGateway = (destination, target) => {
    setSelection(target)
    if (destination !== 'topology') setFilters((previous) => ({ ...previous, [destination]: initialFilters }))
    setView(destination)
    focusTopology.current = destination === 'topology'
  }
  const activeFilter = view === 'topology' ? null : filters[view]

  return (
    <Tabs value={view} onValueChange={(value) => { if (value in views) setView(value as GatewayView) }} className="gap-0">
      <div className="border-b px-4 md:px-8">
        <TabsList aria-label="Gateway views" variant="line" className="mb-1 h-10 gap-4 p-0">
          {Object.entries(views).map(([value, title]) => <TabsTrigger key={value} value={value} className="px-1">{title}</TabsTrigger>)}
        </TabsList>
      </div>
      <TabsContent value={view} className="min-w-0 p-4 pt-8 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{views[view]}</h2>
          <Button variant="outline" disabled={state.pending} onClick={() => {
            setState((previous) => ({ ...previous, pending: true, error: null }))
            setRevision((previous) => previous + 1)
          }}>
            <RefreshCw aria-hidden="true" className={state.pending ? 'animate-spin motion-reduce:animate-none' : ''} />
            Refresh
          </Button>
        </div>
        {activeFilter && <div className="mt-5 flex flex-wrap gap-3">
          <input type="search" aria-label={`Search ${view}`} placeholder={`Search ${view}`} value={activeFilter.query} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm sm:max-w-sm" onChange={(event) => {
            const query = event.target.value
            setFilters((previous) => ({ ...previous, [view]: { ...activeFilter, query } }))
          }} />
          <select aria-label="Configuration filter" value={activeFilter.configuration} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => {
            const configuration = event.target.value
            setFilters((previous) => ({ ...previous, [view]: { ...activeFilter, configuration } }))
          }}>
            <option value="all">All configurations</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
          </select>
        </div>}
        {state.pending && <p role="status" className="mt-6 text-sm text-muted-foreground">{state.snapshot ? 'Refreshing configuration...' : `Loading ${view}...`}</p>}
        {state.error && <div role="alert" className="mt-6 border-l-2 border-destructive py-2 pl-4 text-sm">
          <p className="font-medium">{state.snapshot ? 'Refresh failed - showing previous configuration' : 'Unable to load Gateway configuration'}</p>
          <p className="mt-1">{state.error}</p>
        </div>}
        {state.snapshot?.publication.kind === 'error' && <div role="alert" className="mt-6 border-l-2 border-destructive py-2 pl-4 text-sm">
          <p className="font-medium">Publication status unavailable</p>
          <p className="mt-1">{state.snapshot.publication.message} Configuration remains visible.</p>
        </div>}
        {state.snapshot && <>
          {view === 'endpoints' && <EndpointsView snapshot={state.snapshot} {...filters.endpoints} selectedId={selection?.kind === 'endpoint' ? selection.id : undefined} onNavigate={navigate} />}
          {view === 'upstreams' && <UpstreamsView snapshot={state.snapshot} {...filters.upstreams} selectedId={selection?.kind === 'upstream' ? selection.id : undefined} onNavigate={navigate} />}
          {view === 'topology' && <TopologyView topology={state.snapshot.topology} publication={state.snapshot.publication} selection={selection} onSelect={setSelection} onNavigate={navigate} />}
        </>}
      </TabsContent>
    </Tabs>
  )
}