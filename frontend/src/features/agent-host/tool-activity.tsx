import { Check, CircleAlert, Clock3, Wrench } from 'lucide-react'
import type { RunEvent } from './run-transport'

type ToolResult = Extract<RunEvent['event'], { kind: 'tool.completed' }>['result']
type Invocation = {
  id: string; name: string; arguments: Record<string, unknown> | null
  state: 'running' | 'completed' | 'tool-error' | 'failed'; startedAt: string | null; finishedAt: string | null
  result: ToolResult | null; error: string | null; widgets: RunEvent['event'][]
}

/** Group public invocation events without treating tool errors or widget failures as transport success. */
function projectToolActivity(events: RunEvent[]) {
  const invocations = new Map<string, Invocation>()
  for (const envelope of events) {
    const event = envelope.event
    const widget = event.kind === 'widget.created' ? event.widget : null
    const invocationId = widget?.tool_invocation_id ?? ('tool_invocation_id' in event ? event.tool_invocation_id : null)
    if (!invocationId) continue
    const previous = invocations.get(invocationId) ?? {
      id: invocationId, name: widget?.tool_name ?? ('tool_name' in event ? event.tool_name : ''), arguments: null,
      state: 'running', startedAt: null, finishedAt: null, result: null, error: null, widgets: [],
    }
    let next: Invocation = previous
    if (event.kind === 'tool.started') next = { ...previous, arguments: event.arguments, startedAt: envelope.created_at }
    if (event.kind === 'tool.completed') next = { ...previous, state: event.result.is_error ? 'tool-error' : 'completed', result: event.result, finishedAt: envelope.created_at }
    if (event.kind === 'tool.failed') next = { ...previous, state: 'failed', result: event.result ?? null, error: `${event.error_message} (${event.error_code})`, finishedAt: envelope.created_at }
    if (event.kind === 'widget.created' || event.kind === 'widget.failed') next = { ...previous, widgets: [...previous.widgets, event] }
    invocations.set(invocationId, next)
  }
  return [...invocations.values()]
}

/** Render live tool progress alongside a turn; renderer payloads remain inert until the Apps slice. */
export function ToolActivity({ events, open }: { events: RunEvent[]; open: boolean }) {
  const invocations = projectToolActivity(events)
  if (!invocations.length) return null
  return <ol aria-label="Tool activity" className="my-4 divide-y border-y">{invocations.map((invocation) => {
    const state = invocation.state === 'running' && !open ? 'Outcome unknown' : invocation.state === 'tool-error' ? 'Tool error' : invocation.state.charAt(0).toUpperCase() + invocation.state.slice(1)
    const Icon = invocation.state === 'running' ? Clock3 : invocation.state === 'completed' ? Check : CircleAlert
    const elapsed = invocation.startedAt && invocation.finishedAt ? Date.parse(invocation.finishedAt) - Date.parse(invocation.startedAt) : null
    return <li key={invocation.id} className="min-w-0 py-3 text-xs"><details><summary className="flex flex-wrap items-center gap-2"><Wrench aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 break-all font-medium">{invocation.name}</span><span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground"><Icon aria-hidden="true" className="size-3.5" />{state}{elapsed !== null && elapsed >= 0 && <span>/ {(elapsed / 1000).toFixed(1)}s</span>}</span></summary>
      <dl className="mt-3 space-y-2"><dt className="text-muted-foreground">Invocation</dt><dd className="break-all font-mono">{invocation.id}</dd>{invocation.arguments !== null && <><dt className="text-muted-foreground">Arguments</dt><dd><pre className="whitespace-pre-wrap break-all">{JSON.stringify(invocation.arguments, null, 2)}</pre></dd></>}{invocation.result && <><dt className="text-muted-foreground">Result</dt><dd><pre className="whitespace-pre-wrap break-all">{JSON.stringify(invocation.result, null, 2)}</pre></dd></>}{invocation.error && <><dt className="text-muted-foreground">Failure</dt><dd className="break-words">{invocation.error}</dd></>}</dl>
      {invocation.widgets.map((event, index) => <p key={index} className="mt-3 break-words text-muted-foreground">{event.kind === 'widget.created' ? `App resource received: ${event.widget.application_resource_uri}` : event.kind === 'widget.failed' ? `App unavailable: ${event.error_message}` : ''}</p>)}
    </details></li>
  })}</ol>
}