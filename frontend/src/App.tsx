import { useEffect, useRef, useState } from 'react'
import { FileSearch } from 'lucide-react'
import { BrowserRouter, Link, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { AppShell, type Workspace } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { GatewayWorkspace } from '@/features/gateway/gateway-workspace'
import type { GatewaySnapshot } from '@/features/gateway/api'
import { SessionsWorkspace } from '@/features/gateway/sessions-workspace'
import { StatusWorkspace } from '@/features/status/status-workspace'
import { AgentHostWorkspace } from '@/features/agent-host/agent-host-workspace'

function Application() {
  const location = useLocation()
  const navigate = useNavigate()
  const workspace: Workspace = matchPath('/agent-host', location.pathname) || matchPath('/agent-host/sessions/:id', location.pathname) ? 'agent-host' : location.pathname === '/status' ? 'status' : 'gateway'
  const diagnosticsOpen = Boolean(matchPath('/gateway/sessions', location.pathname) || matchPath('/gateway/sessions/:id', location.pathname))
  const [gatewaySnapshot, setGatewaySnapshot] = useState<GatewaySnapshot | null>(null)
  const gatewayLocation = useRef(workspace === 'gateway' ? location : {
    ...location, pathname: '/gateway/topology', search: '', hash: '', state: null,
  })
  const hostLocation = useRef(workspace === 'agent-host' ? location : { ...location, pathname: '/agent-host', search: '', hash: '', state: null })
  useEffect(() => {
    if (workspace === 'gateway') gatewayLocation.current = location
    if (workspace === 'agent-host') hostLocation.current = location
  }, [location, workspace])
  const selectWorkspace = (destination: Workspace) => {
    if (destination === 'gateway') navigate(gatewayLocation.current.pathname + gatewayLocation.current.search, { state: gatewayLocation.current.state })
    else navigate(destination === 'agent-host' ? hostLocation.current.pathname + hostLocation.current.search : '/status', { state: { focusHeading: true } })
  }
  return (
    <AppShell workspace={workspace} onSelect={selectWorkspace}>
      <section hidden={workspace !== 'gateway'} aria-labelledby="gateway-title">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-6 pb-5 md:px-8">
          <h1 id="gateway-title" className="text-lg font-semibold tracking-tight">Gateway</h1>
          <Button
            variant="ghost"
            size="sm"
            hidden={diagnosticsOpen}
            asChild
          >
            <Link id="gateway-diagnostics" to="/gateway/sessions" state={{
              gatewayReturnTo: location.pathname + location.search,
              gatewayReturnKey: location.key, focusHeading: true,
            }}><FileSearch aria-hidden="true" />Diagnostics</Link>
          </Button>
        </header>
        <div hidden={diagnosticsOpen}>
          <GatewayWorkspace onSnapshot={setGatewaySnapshot} />
        </div>
        <div hidden={!diagnosticsOpen}><SessionsWorkspace topology={gatewaySnapshot?.topology ?? null} /></div>
      </section>

      <div hidden={workspace !== 'agent-host'}><AgentHostWorkspace active={workspace === 'agent-host'} /></div>

      <div hidden={workspace !== 'status'}><StatusWorkspace active={workspace === 'status'} endpoints={gatewaySnapshot?.topology.endpoints} /></div>
    </AppShell>
  )
}

function App() {
  return <BrowserRouter><Application /></BrowserRouter>
}

export default App
