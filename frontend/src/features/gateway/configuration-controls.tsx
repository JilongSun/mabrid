import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  applyGatewayConfiguration,
  GatewayHttpError,
  loadGatewayConfiguration,
  type GatewayConfiguration,
} from './api'

const sourceNames: Record<GatewayConfiguration['applied_source'] | GatewayConfiguration['desired_source'], string> = {
  runtime_file: 'Runtime file',
  unconfigured: 'Unconfigured',
  provided: 'Provided configuration',
  ledger: 'Last-known-good ledger',
  unknown: 'Unavailable',
}

/** Present file identity separately from the active publication and apply only on request. */
export function GatewayConfigurationControls({ revision, onApplied }: { revision: number; onApplied: () => void }) {
  const [status, setStatus] = useState<GatewayConfiguration | null>(null)
  const [applying, setApplying] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [settledRequest, setSettledRequest] = useState<string | null>(null)
  const [mustRefresh, setMustRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const application = useRef<AbortController | null>(null)
  const requestKey = `${revision}:${refresh}`
  const loading = settledRequest !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    loadGatewayConfiguration(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) {
          setStatus(next)
          setError(null)
          setMustRefresh(false)
          setSettledRequest(requestKey)
        }
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'Unable to read configuration status.')
          setMustRefresh(true)
          setSettledRequest(requestKey)
        }
      },
    )
    return () => controller.abort()
  }, [requestKey])

  useEffect(() => () => application.current?.abort(), [])

  async function apply() {
    if (!status || applying || loading || mustRefresh || application.current) return
    const controller = new AbortController()
    application.current = controller
    setApplying(true)
    setError(null)
    try {
      const next = await applyGatewayConfiguration(status.desired_hash, controller.signal)
      if (!controller.signal.aborted) {
        setStatus(next)
        onApplied()
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof GatewayHttpError && failure.status === 409) {
          setError('The configuration file changed. Refresh its status and review it before applying.')
        } else if (failure instanceof GatewayHttpError) {
          setError(failure.message)
        } else {
          setError('The apply outcome is unknown. Refresh configuration status before trying again. The request was not retried.')
        }
        setMustRefresh(true)
      }
    } finally {
      if (!controller.signal.aborted) setApplying(false)
      application.current = null
    }
  }

  return <section id="gateway-configuration-controls" aria-labelledby="gateway-configuration-title" className="mt-5 rounded-lg border p-4">
    <h3 id="gateway-configuration-title" className="font-semibold">Configuration application</h3>
    <p className="mt-2 text-sm text-muted-foreground">Edit the runtime file outside Mabrid, then apply it here. This does not edit the file or restart the process.</p>
    {loading && <p role="status" className="mt-3 text-sm">Loading configuration status...</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {status && <>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Active generation</dt><dd>{status.generation}</dd>
        <dt className="text-muted-foreground">Applied source</dt><dd>{sourceNames[status.applied_source]}</dd>
        <dt className="text-muted-foreground">Current file</dt><dd>{!status.file_valid ? 'Invalid' : status.pending ? 'Changes pending' : 'Applied'}</dd>
        <dt className="text-muted-foreground">Current source</dt><dd>{sourceNames[status.desired_source]}</dd>
        <dt className="text-muted-foreground">Applied at</dt><dd>{status.applied_at}</dd>
      </dl>
      {status.error && <p role="alert" className="mt-3 text-sm text-destructive">{status.error}</p>}
      {status.recovery_required && <p className="mt-3 text-sm">Gateway publication is unavailable until configuration recovery succeeds.</p>}
      {status.host_unavailable && <p className="mt-3 text-sm">Agent Host is unavailable because its assigned endpoint was not available at startup.</p>}
      {status.restart_required && <p className="mt-3 text-sm">A process restart is required to apply process settings or start the unavailable Agent Host.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void apply()} disabled={loading || applying || mustRefresh || !status.file_valid || (!status.pending && !status.error)}>
          {applying ? 'Applying...' : 'Apply file changes'}
        </Button>
        <Button variant="outline" onClick={() => setRefresh((value) => value + 1)} disabled={loading || applying}>Refresh configuration</Button>
      </div>
    </>}
    {!status && !loading && <Button variant="outline" className="mt-4" onClick={() => setRefresh((value) => value + 1)}>Refresh configuration</Button>}
  </section>
}
