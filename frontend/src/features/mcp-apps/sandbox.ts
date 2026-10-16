import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpUiSandboxResourceReadyNotificationSchema } from '@modelcontextprotocol/ext-apps/app-bridge'
import { appSecurityPolicy } from './app-policy'

if (window.parent !== window) {
  let guest: HTMLIFrameElement | null = null
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = JSONRPCMessageSchema.safeParse(event.data)
    if (!message.success) return
    if (event.source === window.parent && event.origin === window.location.origin) {
      const resource = McpUiSandboxResourceReadyNotificationSchema.safeParse(message.data)
      if (resource.success) {
        if (guest) return
        try {
          const { policy } = appSecurityPolicy(resource.data.params.csp)
          guest = document.createElement('iframe')
          guest.title = 'MCP App content'
          guest.setAttribute('sandbox', 'allow-scripts')
          guest.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'")
          guest.referrerPolicy = 'no-referrer'
          guest.style.cssText = 'display:block;width:100%;height:100%;border:0'
          document.body.replaceChildren(guest)
          guest.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></head><body>${resource.data.params.html}</body></html>`
        } catch {
          window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-error', params: {} }, window.location.origin)
        }
      } else guest?.contentWindow?.postMessage(message.data, '*')
    } else if (guest && event.source === guest.contentWindow && event.origin === 'null') {
      if ('method' in message.data && message.data.method.startsWith('ui/notifications/sandbox-')) return
      window.parent.postMessage(message.data, window.location.origin)
    }
  })
  window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, window.location.origin)
}