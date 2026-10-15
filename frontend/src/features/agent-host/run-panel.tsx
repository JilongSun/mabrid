import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HostHttpError } from './api'
import type { RunView } from './use-host-run'

/** Render ephemeral Run output separately from runtime-owned persisted history. */
export function RunPanel({ run, draft, onDraft, send, disabled, available, reason }: {
  run?: RunView; draft: string; onDraft: (value: string) => void; send: () => void; disabled: boolean; available: boolean; reason?: string
}) {
  const progress = run?.events.filter((event) => event.event.kind.startsWith('tool.') || event.event.kind.startsWith('widget.')) ?? []
  const terminal = run?.events.at(-1)?.event
  return <section aria-label="New input and current Run" className="mt-8 border-t pt-5">
    {run && <section aria-label="Current Run" className="mb-6 min-w-0">
      <header className="flex flex-wrap items-baseline gap-3"><h3 className="text-sm font-semibold">Current Run</h3><p role="status" className="text-xs text-muted-foreground">Run {run.phase}</p></header>
      {run.runId && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{run.runId}</p>}
      <p className="mt-4 text-xs font-semibold">User</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{run.input}</p>
      {run.text && <><p className="mt-5 text-xs font-semibold">Assistant</p><p aria-label="Current assistant output" className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{run.text}</p></>}
      {progress.length > 0 && <ol aria-label="Current Run activity" className="mt-5 divide-y border-y">{progress.map((event) => <li key={event.event_id} className="min-w-0 py-3 text-sm"><details><summary className="break-words">{event.sequence}. {event.event.kind}{'tool_name' in event.event ? ` / ${event.event.tool_name}` : event.event.kind === 'widget.created' ? ` / ${event.event.widget.tool_name}` : ''}</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.event, null, 2)}</pre></details></li>)}</ol>}
      {terminal?.kind === 'run.completed' && <p className="mt-4 text-xs text-muted-foreground">Tokens: {terminal.usage.input_tokens} input / {terminal.usage.output_tokens} output</p>}
      {run.error && <div role="alert" className="mt-4 border-l-2 border-destructive py-2 pl-4 text-sm"><p className="break-words">{run.error.message}</p>{run.error instanceof HostHttpError && <p className="mt-2 break-all font-mono text-xs">{run.error.code}{run.error.status !== 200 && ` / HTTP ${run.error.status}`}</p>}</div>}
      {run.phase === 'unknown' && <p className="mt-3 text-sm text-destructive">Execution is unconfirmed. New input is blocked.</p>}
    </section>}
    <form onSubmit={(event) => { event.preventDefault(); if (!disabled && draft.trim()) send() }}>
      <label htmlFor="host-new-input" className="text-sm font-medium">New input</label>
      <textarea id="host-new-input" rows={4} value={draft} onChange={(event) => onDraft(event.target.value)} disabled={!available} className="mt-3 block w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 disabled:opacity-60" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">{!available && <p className="break-words text-xs text-muted-foreground">Session streaming: {reason ?? 'Unknown'}</p>}<Button type="submit" className="ml-auto" disabled={disabled || !draft.trim()}><Send aria-hidden="true" />Send input</Button></div>
    </form>
  </section>
}