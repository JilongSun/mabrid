import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, RefreshCw, Save, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { HttpError } from '@/lib/http'
import { applyHostSettings, hostSettingsDraft, hostSettingsRequest, loadHostSettings, loadHostSettingsStatus, saveHostSettings, type HostSettingsDraft, type HostSettingsFile, type HostSettingsStatus } from './settings-api'

const inputClass = 'mt-2 h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-60'

export function HostSettings({ active, onApplied, runPending }: { active: boolean; onApplied: () => void; runPending: boolean }) {
  const [file, setFile] = useState<HostSettingsFile | null>(null)
  const [status, setStatus] = useState<HostSettingsStatus | null>(null)
  const [draft, setDraft] = useState<HostSettingsDraft | null>(null)
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState(-1)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const operation = useRef<AbortController | null>(null)
  const loading = revision !== loaded

  useEffect(() => {
    if (!active || loaded === revision) return
    const controller = new AbortController()
    Promise.all([loadHostSettings(controller.signal), loadHostSettingsStatus(controller.signal)]).then(([next, state]) => {
      if (controller.signal.aborted) return
      setFile(next); setDraft(hostSettingsDraft(next)); setStatus(state); setDirty(false); setNotice(null)
      const conflict = next.content_hash !== state.file_hash
      setBlocked(conflict); setError(conflict ? 'The runtime file changed while loading. Reload before continuing.' : null); setLoaded(revision)
    }, (failure: unknown) => {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'Unable to load Host settings.'); setBlocked(true); setLoaded(revision)
    })
    return () => controller.abort()
  }, [active, revision, loaded])
  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  function change(update: Partial<HostSettingsDraft>) {
    setDraft((previous) => previous ? { ...previous, ...update } : previous)
    setDirty(true); setNotice(null)
  }
  async function command(apply: boolean) {
    if (!draft || !file || !status || blocked || busy || loading || operation.current) return
    let request
    try { request = hostSettingsRequest(draft, file.content_hash) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid Host settings.'); return }
    const controller = new AbortController()
    operation.current = controller; setBusy(true); setError(null); setNotice(null)
    let confirmed = false
    try {
      if (apply) {
        const next = await applyHostSettings(file.content_hash, controller.signal)
        if (controller.signal.aborted) return
        confirmed = true; setStatus(next); setNotice(next.enabled ? 'Host configuration applied.' : 'Host disabled. Local Session records retained.'); onApplied()
        if (next.file_hash !== file.content_hash) { setBlocked(true); setError('The runtime file changed during application. Reload before continuing.') }
      } else {
        const next = await saveHostSettings(request, controller.signal)
        if (controller.signal.aborted) return
        confirmed = true; setFile(next); setDraft(hostSettingsDraft(next)); setDirty(false); setStatus(null); setNotice('Host settings saved. Not yet applied.')
        const state = await loadHostSettingsStatus(controller.signal)
        if (controller.signal.aborted) return
        setStatus(state)
        if (state.file_hash !== next.content_hash) { setBlocked(true); setError('The runtime file changed after saving. Reload before continuing.') }
      }
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof HttpError) {
        setError(`${confirmed ? 'File saved. ' : ''}${failure.message}`)
        if (failure.code === 'configuration_busy') setStatus((previous) => previous ? { ...previous, busy: true } : previous)
        if (failure.code !== 'configuration_busy') setBlocked(failure.status === 409 || failure.status >= 500)
      } else {
        setError(confirmed ? 'File saved. Application status is unavailable. Reload before continuing.' : `${apply ? 'Application' : 'Save'} outcome unknown. Reload the file and application status before trying again. The request was not retried.`)
        setBlocked(true)
      }
    } finally { operation.current = null; if (!controller.signal.aborted) setBusy(false) }
  }

  return <section aria-labelledby="host-settings-title" className="min-w-0 px-5 py-5 md:px-8">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
      <h1 id="host-settings-title" className="flex items-center gap-3 text-lg font-semibold"><Settings aria-hidden="true" className="size-5" />Host Settings</h1>
      <Button variant="ghost" size="sm" asChild><Link to="/agent-host" state={{ focusHeading: true }}><ArrowLeft aria-hidden="true" />Sessions</Link></Button>
    </header>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm">{loading ? 'Loading Host settings...' : dirty ? 'Unsaved changes' : !status ? 'Host application status unavailable' : status.pending ? 'Pending Host application' : 'Host configuration applied'}{status?.busy && ' / Host busy'}</p>
      <Button variant="outline" disabled={busy || loading} onClick={() => { if (!dirty || window.confirm('Discard unsaved Host settings and reload?')) setRevision((value) => value + 1) }}><RefreshCw aria-hidden="true" />Reload</Button>
    </div>
    {error && <p role="alert" className="mt-4 break-words border-l-2 border-destructive pl-3 text-sm text-destructive">{error}</p>}
    {status?.error && <p role="alert" className="mt-4 break-words border-l-2 border-destructive pl-3 text-sm">{status.error}</p>}
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    {draft && file && <form noValidate onSubmit={(event) => { event.preventDefault(); void command(false) }}>
      <fieldset disabled={busy || loading || blocked} className="min-w-0">
        <section className="mt-6 border-t py-5" aria-labelledby="host-identity-title">
          <h2 id="host-identity-title" className="text-base font-semibold">Host</h2>
          <label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => change({ enabled: event.target.checked, ...(!event.target.checked ? { mcpAppsEnabled: false } : {}) })} />Agent Host enabled</label>
          <div className="mt-5 grid min-w-0 gap-5 sm:grid-cols-2">
            <label className="min-w-0 text-sm" title="Changing Target ID creates a different logical Host. Existing Sessions are not migrated.">Target ID<input className={inputClass} value={draft.targetId} onChange={(event) => change({ targetId: event.target.value })} /></label>
            <label className="min-w-0 text-sm">Assigned endpoint<select className={inputClass} value={draft.endpointSlug} onChange={(event) => change({ endpointSlug: event.target.value })}><option value="">Unassigned</option>{draft.endpointSlug && !file.published_endpoints.includes(draft.endpointSlug) && <option value={draft.endpointSlug}>{draft.endpointSlug} (not published)</option>}{file.published_endpoints.map((slug) => <option key={slug} value={slug}>{slug}</option>)}</select></label>
          </div>
          {draft.targetId !== (file.agent_host.targetId ?? '') && <p role="status" className="mt-4 text-sm">Different Target identity. Existing Sessions will not move to this Host.</p>}
          <label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={draft.mcpAppsEnabled} disabled={!draft.enabled} onChange={(event) => change({ mcpAppsEnabled: event.target.checked })} />MCP Apps enabled</label>
        </section>
        <section className="border-t py-5" aria-labelledby="host-hermes-title">
          <h2 id="host-hermes-title" className="text-base font-semibold">Hermes</h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-muted-foreground">Interface</dt><dd className="break-words">OpenAI Chat Completions</dd></dl>
          <div className="mt-5 grid min-w-0 gap-5 sm:grid-cols-2">
            <label className="min-w-0 text-sm sm:col-span-2">Compatibility base URL<input type="url" className={inputClass} value={draft.baseUrl} onChange={(event) => change({ baseUrl: event.target.value })} /></label>
            <label className="min-w-0 text-sm">API key environment variable<input autoComplete="off" spellCheck={false} className={inputClass} value={draft.apiKeyEnv} onChange={(event) => change({ apiKeyEnv: event.target.value })} /></label>
            <label className="min-w-0 text-sm">Timeout (seconds)<input type="number" min="0.01" step="any" className={inputClass} value={draft.timeoutSeconds} onChange={(event) => change({ timeoutSeconds: event.target.value })} /></label>
          </div>
        </section>
        <section className="border-t py-5" aria-labelledby="host-native-title">
          <h2 id="host-native-title" className="text-base font-semibold">Native Sessions</h2>
          <label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={draft.native} onChange={(event) => change({ native: event.target.checked })} />Native Sessions enabled</label>
          {draft.native && <div className="mt-5 grid min-w-0 gap-5 sm:grid-cols-2">
            <label className="min-w-0 text-sm">Native API root<input type="url" className={inputClass} value={draft.apiRoot} onChange={(event) => change({ apiRoot: event.target.value })} /></label>
            <label className="min-w-0 text-sm" title="Deployment identity. Changing this value never migrates existing Sessions or unsettled Runs.">Binding ID<input className={inputClass} value={draft.bindingId} onChange={(event) => change({ bindingId: event.target.value })} /></label>
          </div>}
        </section>
      </fieldset>
      <div className="flex flex-wrap gap-3 border-t py-5">
        <Button type="submit" disabled={busy || loading || blocked || !dirty}><Save aria-hidden="true" />{busy ? 'Working...' : 'Save'}</Button>
        <Button type="button" variant="outline" disabled={busy || loading || blocked || dirty || !status?.pending || !status.file_valid || status.busy || runPending} onClick={() => void command(true)}><Check aria-hidden="true" />Apply Host</Button>
      </div>
    </form>}
  </section>
}