import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileSearch, Unplug } from 'lucide-react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppShell, type Workspace } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { GatewayWorkspace } from '@/features/gateway/gateway-workspace'

function NotConnected({ message }: { message: string }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
      <Unplug aria-hidden="true" className="mb-4 size-6 text-muted-foreground" />
      <p className="font-medium">Not connected yet</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  )
}

function Application() {
  const location = useLocation()
  const navigate = useNavigate()
  const workspace: Workspace = location.pathname === '/agent-host' ? 'agent-host' : location.pathname === '/status' ? 'status' : 'gateway'
  const gatewayLocation = useRef(workspace === 'gateway' ? location : {
    ...location, pathname: '/gateway/topology', search: '', hash: '', state: null,
  })
  useEffect(() => {
    if (workspace === 'gateway') gatewayLocation.current = location
  }, [location, workspace])
  const selectWorkspace = (destination: Workspace) => {
    if (destination === 'gateway') navigate(gatewayLocation.current.pathname + gatewayLocation.current.search, { state: gatewayLocation.current.state })
    else navigate(destination === 'agent-host' ? '/agent-host' : '/status')
  }
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
    <AppShell workspace={workspace} onSelect={selectWorkspace}>
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
          <GatewayWorkspace />
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

function App() {
  return <BrowserRouter><Application /></BrowserRouter>
}

export default App
