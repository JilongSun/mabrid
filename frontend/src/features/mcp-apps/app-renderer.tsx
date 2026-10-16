import { useEffect, useRef, useState } from 'react'
import { AppRenderer } from '@mcp-ui/client'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prepareAppResource, type HostWidget } from './app-resource'

const hostInfo = { name: 'Mabrid', version: '0.1.0' }
const hostCapabilities = {}
const unsupported = async () => { throw new McpError(ErrorCode.MethodNotFound, 'This App Host method is not supported.') }

/** Own one ephemeral App frame, not the Run transport or a separate MCP connection. */
function AppFrame({ widget, input }: { widget: HostWidget; input?: Record<string, unknown> }) {
  const [resource] = useState(() => {
    try { return { data: prepareAppResource(widget), error: null } } catch (error) { return { data: null, error: error instanceof Error ? error.message : 'The App resource is invalid.' } }
  })
  const [sandbox] = useState(() => ({ url: new URL('sandbox.html', new URL(import.meta.env.BASE_URL, window.location.origin)), csp: resource.data?.csp }))
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(320)
  useEffect(() => {
    if (!resource.data || failed) return
    const timeout = setTimeout(() => setFailed(true), 12_000)
    const initialized = (event: MessageEvent<unknown>) => {
      if (event.source !== container.current?.querySelector('iframe')?.contentWindow || event.origin !== window.location.origin || !event.data || typeof event.data !== 'object' || !('method' in event.data) || event.data.method !== 'ui/notifications/initialized') return
      clearTimeout(timeout)
      setReady(true)
    }
    window.addEventListener('message', initialized)
    return () => { clearTimeout(timeout); window.removeEventListener('message', initialized) }
  }, [resource, failed])
  if (!resource.data || failed) return <p role="alert" className="p-4 text-sm">{resource.error ?? 'App unavailable. The tool result is preserved.'}</p>
  return <div ref={container} aria-label={`${widget.tool_name} App frame`} aria-busy={!ready} style={{ height }} className="relative w-full overflow-hidden [&_iframe]:h-full! [&_iframe]:w-full! [&_iframe]:max-w-full!">
    {!ready && <p role="status" className="absolute inset-x-0 top-0 bg-background p-4 text-sm text-muted-foreground">Initializing App...</p>}
    <AppRenderer html={resource.data.html} sandbox={sandbox} toolName={widget.tool_name} toolResourceUri={widget.application_resource_uri} toolInput={input} toolResult={resource.data.toolResult} hostInfo={hostInfo} hostCapabilities={hostCapabilities}
      onMessage={unsupported} onOpenLink={unsupported} onCallTool={unsupported} onReadResource={unsupported} onListResources={unsupported} onListResourceTemplates={unsupported} onListPrompts={unsupported} onFallbackRequest={unsupported}
      onSizeChanged={({ height: requested }) => { if (typeof requested === 'number' && Number.isFinite(requested)) setHeight(Math.min(640, Math.max(160, requested))) }} onError={() => setFailed(true)} />
  </div>
}

/** Keep reload local to the delivered resource; it never retries a tool or submits agent input. */
export function WidgetRenderer({ widget, input, closed: controlledClosed, onClosedChange }: { widget: HostWidget; input?: Record<string, unknown>; closed?: boolean; onClosedChange?: (closed: boolean) => void }) {
  const [locallyClosed, setLocallyClosed] = useState(false)
  const closed = controlledClosed ?? locallyClosed
  const setClosed = onClosedChange ?? setLocallyClosed
  const [revision, setRevision] = useState(0)
  return <section aria-label={`${widget.tool_name} App`} className="my-5 min-w-0 overflow-hidden rounded-md border">
    <header className="flex items-center justify-between gap-3 border-b px-3 py-2"><h3 className="min-w-0 break-all text-sm font-medium">{widget.tool_name}</h3><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" title="Reload App" aria-label="Reload App" onClick={() => { setClosed(false); setRevision((value) => value + 1) }}><RotateCcw aria-hidden="true" /></Button><Button variant="ghost" size="icon" title="Close App" aria-label="Close App" disabled={closed} onClick={() => setClosed(true)}><X aria-hidden="true" /></Button></div></header>
    {closed ? <p className="p-4 text-sm text-muted-foreground">App closed</p> : <AppFrame key={revision} widget={widget} input={input} />}
  </section>
}