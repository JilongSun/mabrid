import { CircleStop, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HostHttpError, type RunIdentity } from './api'
import type { RunControl } from './use-host-run'

/** Present command receipts without inferring execution outcome or releasing ownership. */
export function RunControls({ identity, state, canStop, canReconcile, busy, stop, reconcile }: {
  identity: RunIdentity; state?: RunControl; canStop: boolean; canReconcile: boolean; busy: boolean
  stop: () => void; reconcile: () => void
}) {
  return <section aria-label="Run controls" className="mt-5 min-w-0 border-y py-4">
    <h3 className="text-sm font-semibold">Run control</h3>
    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{identity.run_id}</p>
    <div className="mt-4 flex flex-wrap gap-3"><Button id={`host-run-stop-${identity.run_id}`} variant="outline" size="sm" disabled={busy || !canStop || state?.accepted === true || state?.settled === true} onClick={stop}><CircleStop aria-hidden="true" />Stop Run</Button><Button id={`host-run-reconcile-${identity.run_id}`} variant="outline" size="sm" disabled={busy || !canReconcile || state?.settled === true} onClick={reconcile}><ShieldCheck aria-hidden="true" />Reconcile Run</Button></div>
    {state?.pending && <p role="status" className="mt-3 text-xs text-muted-foreground">{state.pending === 'cancel' ? 'Requesting stop...' : 'Verifying settlement...'}</p>}
    {state?.accepted !== null && state?.accepted !== undefined && <p role="status" className="mt-3 text-sm">{state.accepted ? 'Stop accepted / settlement unconfirmed' : 'Stop not accepted / settlement unconfirmed'}</p>}
    {state?.settled !== null && state?.settled !== undefined && <p role="status" className="mt-3 text-sm">{state.settled ? 'Settlement verified / original outcome not inferred' : 'Settlement unconfirmed / new input blocked'}</p>}
    {state?.error && <div role="alert" className="mt-3 border-l-2 border-destructive py-2 pl-4 text-sm"><p className="break-words">{state.error.message}</p>{state.error instanceof HostHttpError && <p className="mt-2 break-all font-mono text-xs">{state.error.code} / HTTP {state.error.status}</p>}</div>}
  </section>
}