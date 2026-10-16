import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { RunEvent } from '@/features/agent-host/run-transport'

const WidgetRenderer = lazy(() => import('./app-renderer').then((module) => ({ default: module.WidgetRenderer })))

/** Keep renderer setup and chunk-loading failures outside the conversation's error boundary. */
class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert" className="my-4 text-sm">App unavailable. The tool result is preserved.</p> : this.props.children }
}

/** Render only live delivered Widgets, independently of runtime-owned transcript history. */
export function McpApps({ events, available }: { events: RunEvent[]; available: boolean }) {
  const widgets = events.flatMap(({ event }) => event.kind === 'widget.created' ? [event.widget] : [])
  if (!widgets.length) return null
  if (!available) return <p className="my-4 text-sm text-muted-foreground">App rendering is unavailable. Tool results are preserved.</p>
  return <>{widgets.map((widget) => {
    const input = events.find(({ event }) => event.kind === 'tool.started' && event.tool_invocation_id === widget.tool_invocation_id)?.event
    return <AppBoundary key={widget.widget_id}><Suspense fallback={<p role="status" className="my-4 text-sm text-muted-foreground">Loading App renderer...</p>}><WidgetRenderer widget={widget} input={input?.kind === 'tool.started' ? input.arguments : undefined} /></Suspense></AppBoundary>
  })}</>
}