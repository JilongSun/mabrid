import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HostHttpError } from './api'
import type { AppTurn, RunView } from './use-host-run'
import { ToolActivity } from './tool-activity'
import { SessionApps } from '@/features/mcp-apps/mcp-apps'

/** Render ephemeral Run output separately from runtime-owned persisted history. */
export function RunPanel({ run, appTurns = [], draft, onDraft, send, disabled, available, reason, conversationKey, historyVersion, historyConfirmed = false, appsAvailable = false, children, controls }: {
  run?: RunView; appTurns?: AppTurn[]; draft: string; onDraft: (value: string) => void; send: () => void; disabled: boolean; available: boolean; reason?: string
  conversationKey: string; historyVersion?: string | null; historyConfirmed?: boolean; appsAvailable?: boolean; children?: ReactNode; controls?: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [scroll, setScroll] = useState({ key: conversationKey, following: true })
  const following = scroll.key !== conversationKey || scroll.following
  useLayoutEffect(() => {
    if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [conversationKey, historyVersion, run?.text, run?.events.length, appTurns, following])
  useLayoutEffect(() => {
    if (input.current) { input.current.style.height = 'auto'; input.current.style.height = `${Math.min(144, Math.max(72, input.current.scrollHeight))}px` }
  }, [draft])
  const progress = run?.events.filter((event) => event.event.kind.startsWith('tool.') || event.event.kind.startsWith('widget.')) ?? []
  const terminal = run?.events.at(-1)?.event
  const turn = run && <>
    <article aria-label="Current user message" className="ml-auto max-w-[90%] border-l-2 border-primary/40 bg-muted/40 px-4 py-3"><p className="text-xs font-semibold text-muted-foreground">You</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{run.input}</p></article>
    <article aria-label="Current assistant message" className="mt-6 min-w-0"><h3 className="text-sm font-semibold">Assistant</h3>{run.text ? <p aria-label="Current assistant output" className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{run.text}</p> : (run.phase === 'submitting' || run.phase === 'streaming') && <p className="mt-3 text-sm text-muted-foreground">Thinking...</p>}</article>
    <ToolActivity events={run.events} open={run.phase === 'submitting' || run.phase === 'streaming'} />
  </>
  return <section aria-label="New input and current Run" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="relative min-h-0 flex-1"><div ref={viewport} aria-label="Conversation messages" className="h-full min-h-0 overflow-y-auto overscroll-contain px-5 py-5 md:px-8" onScroll={(event) => { const element = event.currentTarget; const next = element.scrollHeight - element.clientHeight - element.scrollTop < 80; if (next !== following || scroll.key !== conversationKey) setScroll({ key: conversationKey, following: next }) }}>
    <div className="mx-auto w-full max-w-3xl min-w-0">{children}
    <SessionApps turns={appTurns} sessionId={conversationKey} available={appsAvailable} />
    {run && <section aria-label="Current Run" className="mb-6 min-w-0">
      {historyConfirmed ? <details className="mt-4 text-xs text-muted-foreground"><summary>Last turn snapshot</summary><div className="mt-4 text-foreground">{turn}</div></details> : turn}
      <p role="status" className="mt-4 text-xs text-muted-foreground">Run {run.phase}</p>
      <details className="mt-4 text-xs text-muted-foreground"><summary>Run details</summary>{run.runId && <p className="mt-3 break-all font-mono">{run.runId}</p>}
        {progress.length > 0 && <ol aria-label="Current Run activity" className="mt-4 divide-y border-y">{progress.map((event) => <li key={event.event_id} className="min-w-0 py-3"><details><summary className="break-words">{event.sequence}. {event.event.kind}{'tool_name' in event.event ? ` / ${event.event.tool_name}` : event.event.kind === 'widget.created' ? ` / ${event.event.widget.tool_name}` : ''}</summary><pre className="mt-3 whitespace-pre-wrap break-all">{JSON.stringify(event.event, null, 2)}</pre></details></li>)}</ol>}
        {terminal?.kind === 'run.completed' && <p className="mt-3">Tokens: {terminal.usage.input_tokens} input / {terminal.usage.output_tokens} output</p>}
      </details>
      {run.error && <div role={run.phase === 'settled' ? undefined : 'alert'} className="mt-4 border-l-2 border-destructive py-2 pl-4 text-sm">{run.phase === 'settled' && <p className="mb-2 text-xs font-medium">Previous Run error</p>}<p className="break-words">{run.error.message}</p>{run.error instanceof HostHttpError && <p className="mt-2 break-all font-mono text-xs">{run.error.code}{run.error.status !== 200 && ` / HTTP ${run.error.status}`}</p>}</div>}
      {run.phase === 'unknown' && <p className="mt-3 text-sm text-destructive">Execution is unconfirmed. New input is blocked.</p>}
      {run.phase === 'settled' && <p className="mt-3 text-sm text-muted-foreground">Settlement verified. Original Run outcome remains unknown.</p>}
    </section>}
    {controls}
    </div></div>
    {!following && <Button variant="outline" size="icon" title="Latest messages" aria-label="Latest messages" className="absolute right-6 bottom-4 z-10" onClick={() => setScroll({ key: conversationKey, following: true })}><ArrowDown aria-hidden="true" /></Button>}</div>
    <form className="shrink-0 border-t bg-background px-5 py-4 md:px-8" onSubmit={(event) => { event.preventDefault(); if (!disabled && draft.trim()) { setScroll({ key: conversationKey, following: true }); send(); input.current?.focus({ preventScroll: true }) } }}>
      <div className="mx-auto w-full max-w-3xl"><label htmlFor="host-new-input" className="sr-only">Message</label>
      <div className="rounded-md border bg-muted/15 p-3"><textarea ref={input} id="host-new-input" aria-label="New input" placeholder="Message your agent" rows={2} value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} disabled={!available} className="block max-h-36 min-h-18 w-full min-w-0 resize-none bg-transparent text-sm leading-6 outline-none disabled:opacity-60" />
      <div className="mt-2 flex min-h-8 flex-wrap items-center justify-between gap-3">{!available && <p className="min-w-0 break-words text-xs text-muted-foreground">Session streaming: {reason ?? 'Unknown'}</p>}<Button type="submit" size="icon" title="Send input" aria-label="Send input" className="ml-auto" disabled={disabled || !draft.trim()}><ArrowUp aria-hidden="true" /></Button></div></div>
      </div>
    </form>
  </section>
}