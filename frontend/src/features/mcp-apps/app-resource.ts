import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { RunEvent } from '@/features/agent-host/run-transport'
import { appSecurityPolicy } from './app-policy'

export type HostWidget = Extract<RunEvent['event'], { kind: 'widget.created' }>['widget']

/** Validate one freshly delivered App resource without fetching or replaying MCP operations. */
export function prepareAppResource(widget: HostWidget) {
  const contents = widget.resource_contents.filter((content) => content.uri === widget.application_resource_uri)
  if (!widget.application_resource_uri.startsWith('ui://') || contents.length !== 1) throw new Error('The App resource identity is invalid.')
  const content = contents[0]
  if (!/^text\/html\s*;\s*profile=(?:mcp-app|"mcp-app")$/i.test(content.mime_type ?? '')) throw new Error('The App resource format is unsupported.')
  let html = content.text
  if (html == null && content.blob != null) {
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.blob), (character) => character.charCodeAt(0))) } catch { throw new Error('The App resource encoding is invalid.') }
  }
  if (!html?.trim() || html.length > 2 * 1024 * 1024) throw new Error('The App resource is empty or too large.')
  const metadata = { ...widget.resource_metadata, ...content.metadata }
  const ui = metadata.ui
  const rawCsp = ui && typeof ui === 'object' && !Array.isArray(ui) && 'csp' in ui ? ui.csp : undefined
  const { csp } = appSecurityPolicy(rawCsp)
  const result = CallToolResultSchema.safeParse({ content: widget.tool_result.content, structuredContent: widget.tool_result.structured_content ?? undefined, isError: widget.tool_result.is_error, _meta: widget.tool_result.metadata })
  if (!result.success) throw new Error('The App tool result does not match the MCP contract.')
  return { html, csp, toolResult: result.data }
}