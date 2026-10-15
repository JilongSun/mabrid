import { useEffect, useRef, useState } from 'react'
import { HostHttpError } from './api'
import { streamHostRun, type RunEvent } from './run-transport'

export type RunView = {
  sessionId: string; runId: string | null; input: string; text: string; events: RunEvent[]; finishedAt: number | null
  phase: 'submitting' | 'streaming' | 'completed' | 'cancelled' | 'failed' | 'unknown' | 'rejected'
  error: Error | null
}

/** Retain Run presentation across selection changes; unmount is not verified cancellation. */
export function useHostRun() {
  const [runs, setRuns] = useState<Record<string, RunView>>({})
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const uncertain = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current?.abort() }
  }, [])
  const start = async (sessionId: string, input: string) => {
    if (operation.current || uncertain.current || !input.trim()) return false
    const controller = new AbortController()
    operation.current = controller
    let view: RunView = { sessionId, runId: null, input, text: '', events: [], finishedAt: null, phase: 'submitting', error: null }
    const publish = () => { if (mounted.current) setRuns((previous) => ({ ...previous, [sessionId]: view })) }
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
      uncertain.current = view.phase === 'unknown'
      operation.current = null
      publish()
    }
    return true
  }
  const pending = Object.values(runs).find((run) => run.phase === 'submitting' || run.phase === 'streaming' || run.phase === 'unknown')
  return { runs, pending, start }
}