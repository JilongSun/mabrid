import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EndpointDraft, UpstreamDraft } from './runtime-draft'

const input = 'mt-1 h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm'

export function UpstreamFields({ value, onChange, onRemove }: { value: UpstreamDraft; onChange: (value: UpstreamDraft) => void; onRemove: () => void }) {
  return <fieldset className="min-w-0 border-t py-5">
    <legend className="max-w-full break-words px-1 text-base font-semibold">{value.key || 'New upstream'}</legend>
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm">Upstream key<input className={input} value={value.key} readOnly={value.existing} required pattern={value.existing ? undefined : '[a-z][a-z0-9-]*'} onChange={(event) => onChange({ ...value, key: event.target.value })} /></label>
      <label className="flex min-h-9 items-center gap-2 text-sm sm:mt-6"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />Enabled</label>
      {value.transport === 'stdio' ? <p className="text-sm text-muted-foreground">stdio · File-managed</p> : <>
        <label className="text-sm">Transport<select className={input} value={value.transport} onChange={(event) => onChange({ ...value, transport: event.target.value as 'sse' | 'streamable-http' })}><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
        <label className="min-w-0 text-sm">URL<input className={input} type="url" required value={value.url} onChange={(event) => onChange({ ...value, url: event.target.value })} /></label>
      </>}
    </div>
    {value.transport !== 'stdio' && <>
      <h4 className="mt-5 text-sm font-medium">Headers</h4>
      {value.headers.map((header) => <div key={header.id} className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_2.25rem]">
        <label className="min-w-0 text-sm">Header name<input className={input} value={header.name} readOnly={header.existing} required onChange={(event) => onChange({ ...value, headers: value.headers.map((item) => item.id === header.id ? { ...item, name: event.target.value } : item) })} /></label>
        <label className="text-sm">Value operation<select className={input} value={header.action} onChange={(event) => onChange({ ...value, headers: value.headers.map((item) => item.id === header.id ? { ...item, action: event.target.value as typeof header.action, value: '' } : item) })}>{header.existing && <option value="preserve">Preserve</option>}<option value="replace">Replace</option>{header.existing && <option value="remove">Remove</option>}</select></label>
        {header.action === 'replace' ? <label className="min-w-0 text-sm">New value<input className={input} type="password" autoComplete="new-password" value={header.value} onChange={(event) => onChange({ ...value, headers: value.headers.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item) })} /></label> : <p className="flex min-h-9 items-center text-sm text-muted-foreground">{header.action === 'remove' ? 'Will be removed' : 'Configured'}</p>}
        <Button type="button" variant="ghost" size="icon" aria-label="Discard header edit" title="Discard header edit" onClick={() => onChange({ ...value, headers: header.existing ? value.headers.map((item) => item.id === header.id ? { ...item, action: 'preserve', value: '' } : item) : value.headers.filter((item) => item.id !== header.id) })}><Trash2 aria-hidden="true" /></Button>
      </div>)}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...value, headers: [...value.headers, { id: crypto.randomUUID(), name: '', existing: false, action: 'replace', value: '' }] })}><Plus aria-hidden="true" />Add header</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 aria-hidden="true" />Remove upstream</Button>
      </div>
    </>}
  </fieldset>
}

export function EndpointFields({ value, upstreams, onChange, onRemove }: { value: EndpointDraft; upstreams: UpstreamDraft[]; onChange: (value: EndpointDraft) => void; onRemove: () => void }) {
  return <fieldset className="min-w-0 border-t py-5">
    <legend className="max-w-full break-words px-1 text-base font-semibold">{value.key || 'New endpoint'}</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm">Endpoint key<input className={input} value={value.key} readOnly={value.existing} required pattern={value.existing ? undefined : '[a-z][a-z0-9-]*'} onChange={(event) => onChange({ ...value, key: event.target.value })} /></label>
      <label className="min-w-0 text-sm">Display name<input className={input} value={value.displayName} onChange={(event) => onChange({ ...value, displayName: event.target.value })} /></label>
      <label className="text-sm">Mode<select className={input} value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as EndpointDraft['mode'] })}><option value="passthrough">Passthrough</option><option value="aggregate">Aggregate</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />Enabled</label>
    </div>
    <h4 className="mt-5 text-sm font-medium">Bindings</h4>
    {value.bindings.map((binding, index) => <fieldset key={binding.id} className="mt-3 min-w-0 border-l-2 pl-3">
      <legend className="text-xs text-muted-foreground">Binding {index + 1}</legend>
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
        <label className="min-w-0 text-sm">Upstream<select className={input} required value={binding.upstream} onChange={(event) => onChange({ ...value, bindings: value.bindings.map((item) => item.id === binding.id ? { ...item, upstream: event.target.value } : item) })}><option value="">Select upstream</option>{!upstreams.some((upstream) => upstream.key === binding.upstream) && binding.upstream && <option value={binding.upstream}>{binding.upstream} (missing)</option>}{upstreams.map((upstream) => <option key={upstream.id} value={upstream.key}>{upstream.key || 'New upstream'}</option>)}</select></label>
        <label className="min-w-0 text-sm">Namespace<input className={input} value={binding.namespace ?? ''} pattern="[a-z][a-z0-9-]*" onChange={(event) => onChange({ ...value, bindings: value.bindings.map((item) => item.id === binding.id ? { ...item, namespace: event.target.value || null } : item) })} /></label>
        <label className="text-sm">Priority<input className={input} type="number" step="1" required value={binding.priority} onChange={(event) => onChange({ ...value, bindings: value.bindings.map((item) => item.id === binding.id ? { ...item, priority: event.target.valueAsNumber } : item) })} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={binding.enabled} onChange={(event) => onChange({ ...value, bindings: value.bindings.map((item) => item.id === binding.id ? { ...item, enabled: event.target.checked } : item) })} />Binding enabled</label>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove binding ${index + 1}`} title="Remove binding" onClick={() => onChange({ ...value, bindings: value.bindings.filter((item) => item.id !== binding.id) })}><Trash2 aria-hidden="true" /></Button>
      </div>
    </fieldset>)}
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...value, bindings: [...value.bindings, { id: crypto.randomUUID(), upstream: upstreams[0]?.key ?? '', namespace: null, priority: 0, enabled: true }] })}><Plus aria-hidden="true" />Add binding</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 aria-hidden="true" />Remove endpoint</Button>
    </div>
  </fieldset>
}