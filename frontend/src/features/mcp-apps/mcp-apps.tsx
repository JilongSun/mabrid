import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { RunEvent } from '@/features/agent-host/run-transport'
import type { AppTurn } from '@/features/agent-host/use-host-run'

const WidgetRenderer = lazy(() => import('./app-renderer').then((module) => ({ default: module.WidgetRenderer })))

/** Keep renderer setup and chunk-loading failures outside the conversation's error boundary. */
class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert" className="my-4 text-sm">App unavailable. The tool result is preserved.</p> : this.props.children }
}

/** Render only live delivered Widgets, independently of runtime-owned transcript history. */
export function McpApps({ events, available, closed, onClosedChange }: { events: RunEvent[]; available: boolean; closed?: Record<string, boolean>; onClosedChange?: (key: string, closed: boolean) => void }) {
  const widgets = events.flatMap(({ event, session_id, run_id }) => event.kind === 'widget.created' ? [{ widget: event.widget, sessionId: session_id, runId: run_id }] : [])
  if (!widgets.length) return null
  if (!available) return <p className="my-4 text-sm text-muted-foreground">App rendering is unavailable. Tool results are preserved.</p>
  return <>{widgets.map(({ widget, sessionId, runId }) => {
    const key = `${sessionId}/${runId}/${widget.widget_id}`
    const input = events.find(({ event, session_id, run_id }) => session_id === sessionId && run_id === runId && event.kind === 'tool.started' && event.tool_invocation_id === widget.tool_invocation_id)?.event
    return <AppBoundary key={key}><Suspense fallback={<p role="status" className="my-4 text-sm text-muted-foreground">Loading App renderer...</p>}><WidgetRenderer widget={widget} input={input?.kind === 'tool.started' ? input.arguments : undefined} closed={closed?.[key]} onClosedChange={onClosedChange ? (value) => onClosedChange(key, value) : undefined} /></Suspense></AppBoundary>
  })}</>
}

/** Keep delivered App identity and dismissal separate from the current Run and remote history. */
export function SessionApps({ turns, sessionId, available }: { turns: AppTurn[]; sessionId: string; available: boolean }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const owned = turns.filter((turn) => turn.sessionId === sessionId)
  if (!owned.length) return null
  return <section aria-label="Session Apps" className="my-6 min-w-0"><h3 className="text-sm font-semibold">Apps</h3>{owned.map((turn) => <section key={`${turn.sessionId}/${turn.runId}`} aria-label={`Apps for Run ${turn.runId}`} className="mt-4 min-w-0">
    <details className="text-xs text-muted-foreground"><summary>Turn details</summary><p className="mt-3 whitespace-pre-wrap break-words">{turn.input}</p><p className="mt-3 break-all font-mono">{turn.runId}</p></details>
    <McpApps events={turn.events} available={available} closed={closed} onClosedChange={(key, value) => setClosed((previous) => ({ ...previous, [key]: value }))} />
  </section>)}</section>
}