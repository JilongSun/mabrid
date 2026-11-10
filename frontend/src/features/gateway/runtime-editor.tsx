import { useEffect, useRef, useState } from 'react'
import { Check, Plus, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { applyGatewayConfiguration, GatewayHttpError } from './api'
import { loadRuntimeFile, saveRuntimeFile, type RuntimeFile } from './runtime-api'
import { draftFromFile, writeFromDraft, type RuntimeDraft } from './runtime-draft'
import { EndpointFields, UpstreamFields } from './runtime-fields'

export function RuntimeConfigurationEditor({ active, onSaved, onApplied }: { active: boolean; onSaved: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<RuntimeFile | null>(null)
  const [draft, setDraft] = useState<RuntimeDraft | null>(null)
  const [revision, setRevision] = useState(0)
  const [settled, setSettled] = useState(-1)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const operation = useRef<AbortController | null>(null)
  const loading = settled !== revision

  useEffect(() => {
    if (!active || settled === revision) return
    const controller = new AbortController()
    loadRuntimeFile(controller.signal).then((next) => {
      if (controller.signal.aborted) return
      setFile(next)
      setDraft(draftFromFile(next))
      setDirty(false)
      setBlocked(false)
      setError(null)
      setNotice(null)
      setSettled(revision)
    }, (failure: unknown) => {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'Unable to read the runtime file.')
      setBlocked(true)
      setSettled(revision)
    })
    return () => controller.abort()
  }, [active, revision, settled])

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  function change(next: RuntimeDraft) {
    setDraft(next)
    setDirty(true)
    setNotice(null)
  }

  async function save(apply: boolean) {
    if (!draft || !file || busy || blocked || loading || operation.current) return
    let request
    try { request = writeFromDraft(draft, file.content_hash) } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid configuration fields.')
      return
    }
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError(null)
    setNotice(null)
    let saved = false
    try {
      const next = await saveRuntimeFile(request, controller.signal)
      if (controller.signal.aborted) return
      saved = true
      setFile(next)
      setDraft(draftFromFile(next))
      setDirty(false)
      setNotice('Saved. Awaiting application.')
      onSaved()
      if (apply) {
        const status = await applyGatewayConfiguration(next.content_hash, controller.signal)
        if (controller.signal.aborted) return
        setNotice(`Saved and applied. Active generation ${status.generation}.`)
        onApplied()
      }
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof GatewayHttpError) {
        const message = failure.code === 'configuration_restart_required' ? 'Restart the process to apply changed Agent Host settings.' : failure.message
        setError(`${saved ? 'File saved. Application failed: ' : ''}${message}`)
        if (failure.status === 409 || failure.status >= 500) setBlocked(true)
      } else {
        setError(`${saved ? 'File saved. Application' : 'Save'} outcome unknown. Reload the file and check application status before trying again. The request was not retried.`)
        setBlocked(true)
      }
    } finally {
      operation.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return <section hidden={!active} aria-label="Runtime file editor" className="mt-6 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <p className="text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : file?.content_hash ? 'Runtime file' : 'Unconfigured'}</p>
      <Button type="button" variant="outline" disabled={busy || loading} onClick={() => {
        if (!dirty || window.confirm('Discard unsaved edits and reload the runtime file?')) setRevision((value) => value + 1)
      }}><RefreshCw aria-hidden="true" />Reload file</Button>
    </div>
    {loading && <p role="status" className="mt-4 text-sm">Loading runtime file...</p>}
    {error && <p role="alert" className="mt-4 break-words border-l-2 border-destructive pl-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    {draft && file && <form noValidate className="mt-5" onSubmit={(event) => { event.preventDefault(); void save(false) }}>
      <fieldset disabled={busy || loading || blocked} className="min-w-0">
        <Tabs defaultValue="upstreams">
          <TabsList aria-label="Configuration objects" variant="line"><TabsTrigger value="upstreams">Upstreams ({draft.upstreams.length})</TabsTrigger><TabsTrigger value="endpoints">Endpoints ({draft.endpoints.length})</TabsTrigger></TabsList>
          <TabsContent value="upstreams" forceMount className="mt-5 hidden data-[state=active]:block">
            {draft.upstreams.map((upstream) => <UpstreamFields key={upstream.id} value={upstream} onChange={(value) => change({ ...draft, upstreams: draft.upstreams.map((item) => item.id === value.id ? value : item) })} onRemove={() => change({ ...draft, upstreams: draft.upstreams.filter((item) => item.id !== upstream.id) })} />)}
            <Button type="button" variant="outline" onClick={() => change({ ...draft, upstreams: [...draft.upstreams, { id: crypto.randomUUID(), key: '', existing: false, transport: 'streamable-http', enabled: true, url: '', headers: [] }] })}><Plus aria-hidden="true" />Add upstream</Button>
          </TabsContent>
          <TabsContent value="endpoints" forceMount className="mt-5 hidden data-[state=active]:block">
            {draft.endpoints.map((endpoint) => <EndpointFields key={endpoint.id} value={endpoint} upstreams={draft.upstreams} onChange={(value) => change({ ...draft, endpoints: draft.endpoints.map((item) => item.id === value.id ? value : item) })} onRemove={() => change({ ...draft, endpoints: draft.endpoints.filter((item) => item.id !== endpoint.id) })} />)}
            <Button type="button" variant="outline" onClick={() => change({ ...draft, endpoints: [...draft.endpoints, { id: crypto.randomUUID(), key: '', existing: false, displayName: '', mode: 'passthrough', enabled: true, bindings: [] }] })}><Plus aria-hidden="true" />Add endpoint</Button>
          </TabsContent>
        </Tabs>
      </fieldset>
      <dl className="mt-7 grid gap-2 border-t pt-4 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Agent Host</dt><dd>{file.agent_host.enabled ? 'Enabled · Read-only' : 'Disabled · Read-only'}</dd>
        {file.agent_host.target_id && <><dt className="text-muted-foreground">Target</dt><dd className="break-all">{file.agent_host.target_id}</dd></>}
        {file.agent_host.endpoint_slug && <><dt className="text-muted-foreground">Assigned endpoint</dt><dd className="break-all">{file.agent_host.endpoint_slug}</dd></>}
      </dl>
      <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
        <Button type="submit" disabled={busy || loading || blocked || !dirty}><Save aria-hidden="true" />{busy ? 'Saving...' : 'Save'}</Button>
        <Button type="button" variant="outline" disabled={busy || loading || blocked || !dirty} onClick={() => void save(true)}><Check aria-hidden="true" />Save and apply</Button>
      </div>
    </form>}
  </section>
}