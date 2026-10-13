import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileSearch, Unplug } from 'lucide-react'
import { AppShell, type Workspace } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const gatewayViews = [
  {
    id: 'endpoints',
    title: 'Endpoints',
    description: 'MCP connection addresses and the upstreams behind each endpoint.',
    message: 'Endpoint data has not been loaded. This view is not connected to the backend yet.',
  },
  {
    id: 'upstreams',
    title: 'Upstreams',
    description: 'MCP servers connected to the Gateway and their endpoint bindings.',
    message: 'Upstream data has not been loaded. This view is not connected to the backend yet.',
  },
  {
    id: 'topology',
    title: 'Topology',
    description: 'Endpoint-to-upstream relationships through configured bindings.',
    message: 'Topology data has not been loaded. The read-only relationship diagram is not connected to the backend yet.',
  },
] as const

function NotConnected({ message }: { message: string }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
      <Unplug aria-hidden="true" className="mb-4 size-6 text-muted-foreground" />
      <p className="font-medium">Not connected yet</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  )
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>('gateway')
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const diagnosticsTrigger = useRef<HTMLButtonElement>(null)
  const diagnosticsHeading = useRef<HTMLHeadingElement>(null)
  const restoreDiagnosticsFocus = useRef(false)

  useEffect(() => {
    if (workspace !== 'gateway') return
    if (diagnosticsOpen) {
      diagnosticsHeading.current?.focus()
    } else if (restoreDiagnosticsFocus.current) {
      diagnosticsTrigger.current?.focus()
      restoreDiagnosticsFocus.current = false
    }
  }, [diagnosticsOpen, workspace])

  return (
    <AppShell workspace={workspace} onSelect={setWorkspace}>
      <section hidden={workspace !== 'gateway'} aria-labelledby="gateway-title">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-6 pb-5 md:px-8">
          <h1 id="gateway-title" className="text-lg font-semibold tracking-tight">Gateway</h1>
          <Button
            ref={diagnosticsTrigger}
            type="button"
            variant="ghost"
            size="sm"
            hidden={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen(true)}
          >
            <FileSearch aria-hidden="true" />
            Diagnostics
          </Button>
        </header>
        <div hidden={diagnosticsOpen}>
          <Tabs defaultValue="endpoints" className="gap-0">
            <div className="border-b px-4 md:px-8">
              <TabsList aria-label="Gateway views" variant="line" className="mb-1 h-10 gap-4 p-0">
                {gatewayViews.map((view) => (
                  <TabsTrigger key={view.id} value={view.id} className="px-1">
                    {view.title}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {gatewayViews.map((view) => (
              <TabsContent key={view.id} value={view.id} className="p-4 pt-8 md:p-8">
                <h2 className="text-2xl font-semibold tracking-tight">{view.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{view.description}</p>
                <NotConnected message={view.message} />
              </TabsContent>
            ))}
          </Tabs>
        </div>
        {diagnosticsOpen && (
          <section aria-labelledby="diagnostics-title" className="border-t p-4 pt-8 md:p-8">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-6"
              onClick={() => {
                restoreDiagnosticsFocus.current = true
                setDiagnosticsOpen(false)
              }}
            >
              <ArrowLeft aria-hidden="true" />
              Back to Gateway
            </Button>
            <h2
              id="diagnostics-title"
              ref={diagnosticsHeading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              MCP Session diagnostics
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Inspect MCP connection lifecycles and their tool calls, resource reads, and events.
              A session can contain multiple operations; it is not a single tool call.
            </p>
            <NotConnected message="MCP session diagnostics have not been loaded. This secondary view is not connected to the backend yet." />
          </section>
        )}
      </section>

      {workspace === 'agent-host' && (
        <section aria-labelledby="host-title" className="p-4 pt-8 md:p-8">
          <h1 id="host-title" className="text-2xl font-semibold tracking-tight">Agent Host</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            An optional workspace for conversations, tool activity, and MCP Apps.
          </p>
          <NotConnected message="Deployment capabilities have not been loaded. Agent Host availability has not been checked." />
        </section>
      )}

      {workspace === 'status' && (
        <section aria-labelledby="status-title" className="p-4 pt-8 md:p-8">
          <h1 id="status-title" className="text-2xl font-semibold tracking-tight">Connection & capabilities</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Local Gateway readiness and remote Agent Host availability are separate facts.
          </p>
          <NotConnected message="Connection and capability checks are not connected to the backend yet. No service health is reported." />
        </section>
      )}
    </AppShell>
  )
}

export default App
