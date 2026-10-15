import { useEffect, useRef, useState } from 'react'
import { cancelHostRun, HostHttpError, reconcileHostRun, type RunIdentity } from './api'
import { streamHostRun, type RunEvent } from './run-transport'

export type RunView = {
  sessionId: string; runId: string | null; input: string; text: string; events: RunEvent[]; finishedAt: number | null
  phase: 'submitting' | 'streaming' | 'completed' | 'cancelled' | 'failed' | 'unknown' | 'rejected' | 'settled'
  error: Error | null
}

export type RunControl = { pending: 'cancel' | 'reconcile' | null; accepted: boolean | null; settled: boolean | null; verifiedAt: number | null; error: Error | null }
export const runControlKey = (identity: RunIdentity) => `${identity.session_id}/${identity.run_id}`

/** Retain Run presentation across selection changes; unmount is not verified cancellation. */
export function useHostRun() {
  const [runs, setRuns] = useState<Record<string, RunView>>({})
  const views = useRef<Record<string, RunView>>({})
  const [controls, setControls] = useState<Record<string, RunControl>>({})
  const operation = useRef<AbortController | null>(null)
  const command = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const uncertain = useRef<{ sessionId: string; runId: string | null } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current?.abort(); command.current?.abort() }
  }, [])
  const publishView = (view: RunView) => {
    if (!mounted.current) return
    views.current = { ...views.current, [view.sessionId]: view }
    setRuns(views.current)
  }
  const start = async (sessionId: string, input: string) => {
    if (operation.current || command.current || uncertain.current || !input.trim()) return false
    const controller = new AbortController()
    operation.current = controller
    let view: RunView = { sessionId, runId: null, input, text: '', events: [], finishedAt: null, phase: 'submitting', error: null }
    const publish = () => publishView(view)
    publish()
    try {
      await streamHostRun(sessionId, input, controller.signal, (event) => {
        const payload = event.event
        view = { ...view, runId: event.run_id, phase: 'streaming', events: [...view.events, event], text: payload.kind === 'assistant.text.delta' ? view.text + payload.delta : payload.kind === 'assistant.text.completed' ? payload.text : payload.kind === 'run.completed' ? payload.output_text : view.text }
        publish()
      })
      const terminal = view.events.at(-1)?.event
      if (terminal?.kind === 'run.completed') view = { ...view, phase: 'completed' }
      else if (terminal?.kind === 'run.cancelled') view = { ...view, phase: 'cancelled' }
      else if (terminal?.kind === 'run.failed') view = { ...view, phase: terminal.error.code === 'run_state_unknown' ? 'unknown' : 'failed', error: new HostHttpError(terminal.error.message, 200, terminal.error.code) }
      else view = { ...view, phase: 'unknown', error: new Error('Run outcome is unknown.') }
    } catch (error) {
      const rejected = error instanceof HostHttpError && view.events.length === 0 && !['target_busy', 'run_state_unknown'].includes(error.code)
      view = { ...view, phase: rejected ? 'rejected' : 'unknown', error: error instanceof Error ? error : new Error('Run outcome is unknown. The input has not been resubmitted.') }
    } finally {
      view = { ...view, finishedAt: Date.now() }
      uncertain.current = view.phase === 'unknown' ? { sessionId, runId: view.runId } : null
      operation.current = null
      publish()
    }
    return true
  }
  const control = async (identity: RunIdentity, action: 'cancel' | 'reconcile') => {
    if (command.current || action === 'reconcile' && operation.current) return false
    const controller = new AbortController()
    command.current = controller
    const key = runControlKey(identity)
    const empty: RunControl = { pending: action, accepted: null, settled: null, verifiedAt: null, error: null }
    setControls((previous) => ({ ...previous, [key]: { ...(previous[key] ?? empty), pending: action, error: null } }))
    try {
      if (action === 'cancel') {
        const receipt = await cancelHostRun(identity, controller.signal)
        if (mounted.current) setControls((previous) => ({ ...previous, [key]: { ...previous[key], pending: null, accepted: receipt.accepted } }))
      } else {
        const receipt = await reconcileHostRun(identity, controller.signal)
        if (!mounted.current) return false
        const verifiedAt = receipt.settled ? Date.now() : null
        setControls((previous) => ({ ...previous, [key]: { ...previous[key], pending: null, settled: receipt.settled, verifiedAt } }))
        const blocked = uncertain.current
        if (receipt.settled && blocked && (blocked.runId === null || blocked.sessionId === identity.session_id && blocked.runId === identity.run_id)) {
          const previous = views.current[blocked.sessionId]
          uncertain.current = null
          if (previous?.phase === 'unknown') publishView({ ...previous, phase: 'settled', finishedAt: verifiedAt })
        }
      }
      return true
    } catch (error) {
      if (mounted.current) setControls((previous) => ({ ...previous, [key]: { ...previous[key], pending: null, error: error instanceof Error ? error : new Error('Run settlement is unconfirmed.') } }))
      return false
    } finally { command.current = null }
  }
  const pending = Object.values(runs).find((run) => run.phase === 'submitting' || run.phase === 'streaming' || run.phase === 'unknown')
  const controlPending = Object.values(controls).some((state) => state.pending !== null)
  const settledAt = Math.max(0, ...Object.values(controls).map((state) => state.verifiedAt ?? 0))
  return { runs, pending, start, controls, controlPending, settledAt, cancel: (identity: RunIdentity) => control(identity, 'cancel'), reconcile: (identity: RunIdentity) => control(identity, 'reconcile') }
}