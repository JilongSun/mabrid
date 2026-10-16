import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { Link, matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { useGatewayPagePosition } from '@/features/gateway/gateway-navigation'
import { loadCapabilities, type Capabilities } from '@/features/status/api'
import { createHostSession, HostHttpError, loadHostHistory, loadHostSession, loadHostSessions, type HistoryPage, type HostSession } from './api'
import { useHostRead } from './use-host-read'
import { runControlKey, useHostRun } from './use-host-run'
import { RunPanel } from './run-panel'
import { RunControls } from './run-controls'

const capabilityRead = (_key: string, signal: AbortSignal) => loadCapabilities(signal)
const sessionPageRead = (key: string, signal: AbortSignal) => loadHostSessions(Number(key), signal)
const historyRead = (key: string, signal: AbortSignal) => {
  const params = new URLSearchParams(key)
  return loadHostHistory(params.get('session')!, { limit: 100, offset: Number(params.get('offset')), order: params.get('order') === 'oldest' ? 'oldest' : 'latest' }, signal)
}
const words = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ')
const offsetValue = (value: string | null) => value === null ? 0 : /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
type ReadState = { data: unknown; loadedAt: string | null; error: Error | null; pending: boolean }

function ReadFeedback({ state, label, compact = false }: { state: ReadState; label: string; compact?: boolean }) {
  return <>
    {state.pending && !state.data && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading {label}...</p>}
    {state.loadedAt && !compact && <p className="mt-3 text-xs text-muted-foreground">Read at <time dateTime={state.loadedAt}>{state.loadedAt}</time>{state.pending && <span role="status" className="ml-3">Refreshing {label}...</span>}</p>}
    {state.error && <div role="alert" className="mt-4 border-l-2 border-destructive py-2 pl-4 text-sm">
      <p className="font-medium">{state.data ? `Refresh failed - showing previous ${label}` : `Unable to load ${label}`}</p>
      <p className="mt-1 break-words">{state.error.message}</p>
      {state.error instanceof HostHttpError && <p className="mt-2 break-all font-mono text-xs">{state.error.code} / HTTP {state.error.status}</p>}
    </div>}
  </>
}

function FeatureState({ feature, label }: { feature: Capabilities['agent_host']['features']['session_list']; label: string }) {
  return <p className="mt-4 break-words text-sm text-muted-foreground">{label}: {words(feature.availability)} / {words(feature.reason)}</p>
}

function HistoryMessages({ page }: { page: HistoryPage }) {
  return page.messages.length === 0 ? <p className="my-8 text-sm text-muted-foreground">No messages in this history window</p> : <ol aria-label="Session history" className="space-y-7 py-5">
    {page.messages.map((message) => <li key={message.message_id} className={message.role === 'user' ? 'ml-auto min-w-0 max-w-[90%] border-l-2 border-primary/40 bg-muted/40 px-4 py-3' : 'min-w-0'}>
      <header className="mb-3 flex flex-wrap items-baseline gap-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{message.role === 'unsupported' ? 'Unsupported role' : message.role === 'user' ? 'You' : words(message.role)}</span>{message.tool_name && <span className="break-all font-mono">{message.tool_name}</span>}</header>
      <div className="space-y-3 text-sm leading-6">{message.content.map((content, index) => <div key={index} className="min-w-0">
        {content.kind === 'text' ? <p className="whitespace-pre-wrap break-words">{content.text}</p> : content.kind === 'unsupported' ? <p className="break-words text-muted-foreground">Unsupported content: {content.content_type}</p> : <details><summary className="break-words font-medium">Tool call: {content.tool_name}</summary><p className="mt-3 break-all font-mono text-xs">{content.tool_call_id}</p><pre className="mt-3 whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(content.arguments, null, 2)}</pre></details>}
      </div>)}</div>
      <details className="mt-3"><summary className="text-xs text-muted-foreground">Message details</summary><dl className="mt-3 space-y-2 break-all font-mono text-xs"><dt>Message ID</dt><dd>{message.message_id}</dd>{message.created_at && <><dt>Created at</dt><dd><time dateTime={message.created_at}>{message.created_at}</time></dd></>}{message.tool_call_id && <><dt>Tool call ID</dt><dd>{message.tool_call_id}</dd></>}</dl></details>
    </li>)}
  </ol>
}

/** Compose Session browsing and commands without owning the Run stream transport. */
export function AgentHostWorkspace({ active }: { active: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const selectedId = matchPath('/agent-host/sessions/:id', location.pathname)?.params.id
  const validId = !selectedId || z.uuid().safeParse(selectedId).success
  const offset = offsetValue(params.get('offset'))
  const historyOffset = offsetValue(params.get('history_offset'))
  const order = params.get('history_order') ?? 'latest'
  const validHistoryQuery = historyOffset !== null && (order === 'latest' || order === 'oldest')
  const capabilities = useHostRead(active ? 'capabilities' : null, capabilityRead)
  const features = capabilities.data?.agent_host.features
  const available = (feature: 'session_list' | 'session_reopen' | 'session_history' | 'session_create' | 'session_streaming' | 'run_cancel' | 'run_reconcile') => Boolean(capabilities.data?.agent_host.enabled && features?.[feature].implemented && features[feature].enabled && features[feature].availability === 'available')
  const sessions = useHostRead(active && available('session_list') && offset !== null ? String(offset) : null, sessionPageRead)
  const metadata = useHostRead(active && validId && selectedId && available('session_reopen') ? selectedId : null, loadHostSession)
  const historyKey = selectedId && validHistoryQuery ? new URLSearchParams({ session: selectedId, offset: String(historyOffset), order }).toString() : null
  const history = useHostRead(active && validId && available('session_history') ? historyKey : null, historyRead)
  const heading = useRef<HTMLHeadingElement>(null)
  useGatewayPagePosition(heading, Boolean(capabilities.data) || !capabilities.pending, active, Boolean(selectedId))
  const current = metadata.data ?? sessions.data?.sessions.find((session) => session.session_id === selectedId)
  const targetRun = metadata.data ? metadata.data.target_run : sessions.data?.sessions.find((session) => session.target_run)?.target_run
  const execution = useHostRun()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [creation, setCreation] = useState<{ pending: boolean; error: Error | null; session: HostSession | null }>({ pending: false, error: null, session: null })
  const creating = useRef<AbortController | null>(null)
  const navigation = useRef({ active, path: location.pathname })
  const alive = useRef(true)
  useEffect(() => { navigation.current = { active, path: location.pathname } }, [active, location.pathname])
  useEffect(() => { alive.current = true; return () => { alive.current = false; creating.current?.abort() } }, [])
  const create = async () => {
    if (creating.current || !available('session_create')) return
    const controller = new AbortController()
    creating.current = controller
    const path = location.pathname
    setCreation({ pending: true, error: null, session: null })
    try {
      const session = await createHostSession(title, controller.signal)
      if (!alive.current) return
      setCreation({ pending: false, error: null, session })
      setTitle('')
      sessions.refresh()
      if (navigation.current.active && navigation.current.path === path) navigate(`/agent-host/sessions/${session.session_id}`, { state: { focusHeading: true } })
    } catch (error) {
      if (alive.current) setCreation({ pending: false, error: error instanceof Error ? error : new Error('Session creation is unconfirmed.'), session: null })
    } finally { creating.current = null }
  }
  const run = selectedId ? execution.runs[selectedId] : undefined
  const metadataIsFresh = (!run || run.phase === 'rejected' || run.finishedAt !== null && metadata.startedAt > run.finishedAt) && metadata.startedAt > execution.settledAt
  const canSend = available('session_streaming') && !execution.pending && !execution.controlPending && !targetRun && metadata.data?.binding_state === 'available' && !metadata.pending && !metadata.error && metadataIsFresh
  const ownedLease = targetRun?.session_id === selectedId ? targetRun : null
  const controlIdentity = ownedLease && ownedLease.run_id !== run?.runId ? ownedLease : run?.runId ? { session_id: run.sessionId, run_id: run.runId } : ownedLease
  const controlState = controlIdentity ? execution.controls[runControlKey(controlIdentity)] : undefined
  const verifiedTerminal = run?.runId === controlIdentity?.run_id && run && ['completed', 'cancelled', 'failed', 'settled'].includes(run.phase)
  const localStreamOpen = execution.pending?.phase === 'submitting' || execution.pending?.phase === 'streaming'
  const historyConfirmed = Boolean(run?.finishedAt && !['unknown', 'rejected'].includes(run.phase) && history.data?.query.order === 'latest' && history.data.query.offset === 0 && !history.error && history.startedAt > run.finishedAt)
  const send = async () => {
    if (!selectedId || !canSend) return
    const input = drafts[selectedId] ?? ''
    if (!input.trim()) return
    setDrafts((previous) => ({ ...previous, [selectedId]: '' }))
    await execution.start(selectedId, input)
    if (alive.current && navigation.current.active && navigation.current.path === `/agent-host/sessions/${selectedId}`) { metadata.refresh(); history.refresh() }
  }
  const changePage = (name: string, value: string) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    if (value === '0') next.delete(name)
    else next.set(name, value)
    return next
  })
  if (!active) return null
  return <section aria-labelledby="host-title" className="flex h-[calc(100svh-4rem)] min-h-[30rem] min-w-0 flex-col overflow-hidden md:h-svh">
    <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3"><h1 id="host-title" ref={heading} tabIndex={-1} className="flex items-center gap-3 text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"><MessageSquare aria-hidden="true" className="size-5" />Agent Host</h1><Button id="host-capabilities-refresh" variant="ghost" size="icon" title="Refresh capabilities" aria-label="Refresh capabilities" disabled={capabilities.pending} onClick={capabilities.refresh}><RefreshCw aria-hidden="true" /></Button></header>
    <div className="shrink-0 px-5"><ReadFeedback state={capabilities} label="Host capabilities" compact />
    {capabilities.data && !capabilities.data.agent_host.enabled && <p className="mt-5 text-sm">Agent Host disabled</p>}
    {targetRun && <section aria-label="Target Run" role="status" className="mt-5 border-y py-4 text-sm"><p className="font-medium">Target Run {targetRun.state}</p><p className="mt-2 break-all font-mono text-xs">Run: {targetRun.run_id}</p><Link id="host-target-run-session" className="mt-2 inline-block break-all underline-offset-4 hover:underline" to={`/agent-host/sessions/${targetRun.session_id}`}>Session: {targetRun.session_id}</Link></section>}
    {execution.pending && execution.pending.sessionId !== selectedId && <p role="status" className="mt-5 text-sm">Run {execution.pending.phase} / <Link className="break-all underline" to={`/agent-host/sessions/${execution.pending.sessionId}`}>Session: {execution.pending.sessionId}</Link></p>}
    </div><div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
      <section aria-labelledby="host-sessions-title" className="max-h-44 min-w-0 overflow-y-auto border-b bg-muted/15 p-4 md:max-h-none md:border-r md:border-b-0">
        <header className="flex items-center justify-between gap-3"><h2 id="host-sessions-title" className="text-base font-semibold">Sessions</h2><Button id="host-sessions-refresh" variant="ghost" size="icon" title="Refresh Sessions" aria-label="Refresh Sessions" disabled={!available('session_list') || sessions.pending || offset === null} onClick={sessions.refresh}><RefreshCw aria-hidden="true" /></Button></header>
        <form className="mt-5 border-b pb-5" onSubmit={(event) => { event.preventDefault(); void create() }}><label htmlFor="host-session-title" className="text-xs text-muted-foreground">Session title (optional)</label><input id="host-session-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!available('session_create') || creation.pending} className="mt-2 h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-60" /><Button type="submit" variant="outline" size="sm" className="mt-3" disabled={!available('session_create') || creation.pending}><Plus aria-hidden="true" />{creation.pending ? 'Creating Session...' : 'New Session'}</Button></form>
        {features && !available('session_create') && <FeatureState feature={features.session_create} label="Session creation" />}
        {creation.error && <div role="alert" className="mt-4 break-words text-sm text-destructive"><p>{creation.error.message}</p>{creation.error instanceof HostHttpError && <p className="mt-2 font-mono text-xs">{creation.error.code} / HTTP {creation.error.status}</p>}</div>}
        {creation.session && <p className="mt-3 break-words text-xs"><Link className="underline" to={`/agent-host/sessions/${creation.session.session_id}`}>Created Session: {creation.session.title || creation.session.session_id}</Link></p>}
        {offset === null && <p role="alert" className="mt-4 text-sm">Invalid Session page offset</p>}
        {features && !available('session_list') && <FeatureState feature={features.session_list} label="Session list" />}
        <ReadFeedback state={sessions} label="Sessions" />
        {sessions.data && (sessions.data.sessions.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No Agent Sessions</p> : <ul aria-label="Agent Sessions" className="mt-4 divide-y border-y">{sessions.data.sessions.map((session) => <li key={session.session_id} className="min-w-0 py-4"><Link id={`host-session-${session.session_id}`} aria-current={selectedId === session.session_id ? 'page' : undefined} to={`/agent-host/sessions/${session.session_id}${offset ? `?offset=${offset}` : ''}`} state={{ focusHeading: true }} className="block break-words text-sm font-medium underline-offset-4 hover:underline">{session.title || session.session_id}</Link><p className="mt-2 break-words text-xs text-muted-foreground">{words(session.binding_state)} / {session.created_at}</p></li>)}</ul>)}
        <div className="mt-4 flex flex-wrap gap-3">{offset !== null && offset > 0 && <Button variant="outline" size="sm" disabled={sessions.pending} onClick={() => changePage('offset', String(Math.max(0, offset - 20)))}><ArrowLeft aria-hidden="true" />Previous Sessions</Button>}{sessions.data?.has_more && <Button variant="outline" size="sm" disabled={sessions.pending} onClick={() => changePage('offset', String((offset ?? 0) + 20))}>Next Sessions<ArrowRight aria-hidden="true" /></Button>}</div>
      </section>
      <section aria-labelledby="host-history-title" className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3 md:px-8"><h2 id="host-history-title" className="min-w-0 break-words text-base font-semibold">{current?.title || 'New conversation'}</h2>{selectedId && <Button id="host-history-refresh" variant="ghost" size="icon" title="Refresh Session" aria-label="Refresh Session" disabled={history.pending || metadata.pending || !validId || !validHistoryQuery || !available('session_history') && !available('session_reopen')} onClick={() => { metadata.refresh(); history.refresh() }}><RefreshCw aria-hidden="true" /></Button>}</header>
        <RunPanel conversationKey={selectedId ?? 'new'} historyVersion={history.loadedAt} historyConfirmed={historyConfirmed} run={run} draft={drafts[selectedId ?? 'new'] ?? ''} onDraft={(value) => setDrafts((previous) => ({ ...previous, [selectedId ?? 'new']: value }))} available={Boolean(selectedId && validId && available('session_streaming'))} reason={features ? `${words(features.session_streaming.availability)} / ${words(features.session_streaming.reason)}` : undefined} disabled={!canSend || !selectedId} send={() => { void send() }} controls={<>
          {controlIdentity && <><RunControls identity={controlIdentity} state={controlState} canStop={available('run_cancel') && !verifiedTerminal} canReconcile={available('run_reconcile') && !localStreamOpen && !verifiedTerminal} busy={execution.controlPending} stop={() => { void execution.cancel(controlIdentity) }} reconcile={() => { void execution.reconcile(controlIdentity) }} />{features && !available('run_cancel') && <FeatureState feature={features.run_cancel} label="Run cancellation" />}{features && !available('run_reconcile') && <FeatureState feature={features.run_reconcile} label="Run reconciliation" />}</>}
          {(run || execution.settledAt > 0) && !metadataIsFresh && !execution.pending && <p role="status" className="mt-5 text-sm text-muted-foreground">Session metadata refresh required</p>}
        </>}>
        {!selectedId ? <div className="flex min-h-56 flex-col items-center justify-center gap-4 text-muted-foreground"><MessageSquare aria-hidden="true" className="size-8" /><p className="text-sm">No Session selected</p></div> : !validId ? <p role="alert" className="text-sm">Invalid Agent Session ID</p> : <>
          <div className="mb-5 flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground"><details><summary>Session details</summary><p className="mt-4 break-all font-mono">{selectedId}</p><ReadFeedback state={{ ...metadata, error: null, pending: false }} label="Session metadata" />{current && <dl className="mt-4 grid gap-x-5 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt>Binding state</dt><dd>{words(current.binding_state)}</dd><dt>Target</dt><dd className="break-all">{current.target_id}</dd><dt>Created at</dt><dd className="break-all">{current.created_at}</dd></dl>}</details>
          <details><summary>History window</summary><div className="mt-4 flex flex-wrap items-center gap-3"><label htmlFor="host-history-order">History order</label><select id="host-history-order" aria-label="History order" value={order} disabled={!available('session_history')} className="h-8 max-w-full rounded-md border bg-background px-2 text-xs" onChange={(event) => setParams((previous) => { const next = new URLSearchParams(previous); next.set('history_order', event.target.value); next.delete('history_offset'); return next })}>{order !== 'latest' && order !== 'oldest' && <option value={order}>{order}</option>}<option value="latest">Latest window</option><option value="oldest">Oldest window</option></select></div><ReadFeedback state={{ ...history, error: null, pending: false }} label="Session history" />{history.data && <p className="mt-3">History offset: {history.data.query.offset} / More history: {history.data.has_more == null ? 'Unknown' : history.data.has_more ? 'Yes' : 'No'}</p>}</details></div>
          {features && !available('session_reopen') && <FeatureState feature={features.session_reopen} label="Session reopening" />}
          <ReadFeedback state={metadata} label="Session metadata" compact />
          {!validHistoryQuery && <p role="alert" className="mt-4 text-sm">Invalid history pagination</p>}
          {features && !available('session_history') && <FeatureState feature={features.session_history} label="Session history" />}
          <ReadFeedback state={history} label="Session history" compact />
          <div className="mb-4 flex flex-wrap gap-3">{historyOffset !== null && historyOffset > 0 && <Button size="sm" variant="outline" disabled={history.pending} onClick={() => changePage('history_offset', String(Math.max(0, historyOffset - 100)))}><ArrowLeft aria-hidden="true" />{order === 'latest' ? 'Newer messages' : 'Older messages'}</Button>}{history.data && history.data.has_more !== false && history.data.messages.length > 0 && <Button size="sm" variant="outline" disabled={history.pending} onClick={() => changePage('history_offset', String((historyOffset ?? 0) + 100))}>{order === 'latest' ? 'Older messages' : 'Newer messages'}<ArrowRight aria-hidden="true" /></Button>}</div>
          {history.data && <HistoryMessages page={history.data} />}
        </>}
        </RunPanel>
      </section>
    </div>
  </section>
}