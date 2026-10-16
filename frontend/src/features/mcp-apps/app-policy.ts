import { McpUiResourceCspSchema } from '@modelcontextprotocol/ext-apps/app-bridge'

function sources(values: string[] = []) {
  return values.map((value) => {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('The App resource security policy is unsupported.') }
    const developmentLoopback = import.meta.env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !developmentLoopback || url.username || url.password || url.search || url.hash || url.pathname !== '/' || /[\s;'"]/.test(value)) throw new Error('The App resource security policy is unsupported.')
    return url.origin
  })
}

/** Constrain declared App networks; embedded documents never inherit the Host's origin or permissions. */
export function appSecurityPolicy(value: unknown) {
  const parsed = McpUiResourceCspSchema.safeParse(value ?? {})
  if (!parsed.success) throw new Error('The App resource security policy is invalid.')
  const csp = { connectDomains: sources(parsed.data.connectDomains), resourceDomains: sources(parsed.data.resourceDomains), baseUriDomains: sources(parsed.data.baseUriDomains) }
  const resources = csp.resourceDomains.join(' ')
  const policy = ["default-src 'none'", `script-src 'unsafe-inline' ${resources}`, `style-src 'unsafe-inline' ${resources}`, `img-src data: ${resources}`, `font-src data: ${resources}`, `media-src data: ${resources}`, `connect-src ${csp.connectDomains.join(' ') || "'none'"}`, "frame-src 'none'", "object-src 'none'", `base-uri ${csp.baseUriDomains.join(' ') || "'none'"}`, "form-action 'none'"].join('; ')
  return { csp, policy }
}