import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  Bot,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export type Workspace = 'gateway' | 'agent-host' | 'status'

const navigation = [
  { id: 'gateway', label: 'Gateway', icon: Network },
  { id: 'agent-host', label: 'Agent Host', icon: Bot },
  { id: 'status', label: 'Connection & capabilities', icon: Activity },
] as const

function ProductNavigation({
  workspace,
  onSelect,
  collapsed = false,
  label,
}: {
  workspace: Workspace
  onSelect: (workspace: Workspace) => void
  collapsed?: boolean
  label: string
}) {
  return (
    <nav aria-label={label} className="flex flex-1 flex-col gap-1 p-3">
      {navigation.map(({ id, label: itemLabel, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant={workspace === id ? 'secondary' : 'ghost'}
          aria-current={workspace === id ? 'page' : undefined}
          aria-label={itemLabel}
          title={collapsed ? itemLabel : undefined}
          className={cn(
            'h-10 w-full justify-start gap-3',
            collapsed && 'justify-center px-0',
            id === 'status' && 'mt-auto',
          )}
          onClick={() => onSelect(id)}
        >
          <Icon aria-hidden="true" />
          <span className={collapsed ? 'sr-only' : 'text-xs'}>{itemLabel}</span>
        </Button>
      ))}
    </nav>
  )
}

export function AppShell({
  workspace,
  onSelect,
  children,
}: {
  workspace: Workspace
  onSelect: (workspace: Workspace) => void
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 48rem)')
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  return (
    <div className="min-h-svh md:flex">
      <a
        href="#workspace"
        className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to workspace
      </a>
      <aside
        aria-label="Product sidebar"
        className={cn(
          'sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
          <span aria-hidden="true" className="text-base font-semibold">M</span>
          <span className={collapsed ? 'sr-only' : 'font-semibold tracking-tight'}>
            Mabrid
          </span>
        </div>
        <ProductNavigation
          label="Product navigation"
          workspace={workspace}
          onSelect={onSelect}
          collapsed={collapsed}
        />
        <div className="border-t p-3">
          <Button
            type="button"
            variant="ghost"
            className={cn('h-10 w-full gap-3', collapsed ? 'px-0' : 'justify-start')}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed
              ? <PanelLeftOpen aria-hidden="true" />
              : <PanelLeftClose aria-hidden="true" />}
            {!collapsed && <span className="text-xs">Collapse navigation</span>}
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-16 items-center gap-3 border-b px-4 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Open navigation">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="max-w-72 gap-0 bg-sidebar">
              <SheetHeader className="border-b">
                <SheetTitle>Mabrid</SheetTitle>
                <SheetDescription className="sr-only">Choose a workspace.</SheetDescription>
              </SheetHeader>
              <ProductNavigation
                label="Mobile product navigation"
                workspace={workspace}
                onSelect={(next) => {
                  onSelect(next)
                  setMobileOpen(false)
                }}
              />
            </SheetContent>
          </Sheet>
          <span className="font-semibold tracking-tight">Mabrid</span>
        </header>
        <main id="workspace" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  )
}
