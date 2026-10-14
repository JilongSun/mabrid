import { z } from 'zod'
import { readGateway } from './api'

const recordSchema = z.record(z.string(), z.unknown())
export const sessionStatusSchema = z.enum(['starting', 'active', 'closing', 'closed', 'failed'])
export const sessionSchema = z.object({
  session_id: z.uuid(), endpoint_id: z.uuid(), endpoint_revision_id: z.uuid(),
  status: z.string(), created_at: z.string(), last_activity_at: z.string(),
  closed_at: z.string().nullable(), error_message: z.string().nullable(),
})
export const sessionPageSchema = z.object({
  items: z.array(sessionSchema), next_cursor: z.string().nullable(),
})
const initializationSchema = z.object({
  server_name: z.string(), server_version: z.string().nullable().optional(),
  protocol_version: z.string().nullable().optional(),
  supports_tools: z.boolean().optional(), supports_resources: z.boolean().optional(),
  raw_capabilities: recordSchema.optional(),
})
export const sessionSnapshotSchema = z.object({
  session_id: z.string(), status: z.string(), updated_at: z.string(),
  event_count: z.int().nonnegative(), last_error: z.string().nullable(),
  upstream: initializationSchema.nullable(),
  upstream_availability: z.array(z.object({
    upstream_server_id: z.string(), upstream_revision_id: z.string(),
    binding_revision_id: z.string(), status: z.string(), updated_at: z.string(),
    namespace: z.string().nullable().optional(), identity: initializationSchema.nullable().optional(),
    failure_kind: z.string().nullable().optional(), error_message: z.string().nullable().optional(),
  })),
  discovered_tools: z.array(z.object({
    name: z.string(), title: z.string().nullable().optional(), description: z.string().nullable().optional(),
    input_schema: recordSchema.optional(), output_schema: recordSchema.nullable().optional(),
    annotations: recordSchema.optional(), metadata: recordSchema.optional(),
    ui_resource_uri: z.string().nullable().optional(),
  })),
  active_tool_calls: z.array(z.object({
    call_id: z.string(), tool_name: z.string(), status: z.string(), started_at: z.string(),
  })),
  resource_reads: z.array(z.object({
    requested_uri: z.string(), loaded_at: z.string(), contents: z.array(z.unknown()),
  })),
})

export type McpSession = z.infer<typeof sessionSchema>
export type SessionPage = z.infer<typeof sessionPageSchema>
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>
export type SessionFilters = { endpointId: string; status: string; cursor: string }

export function sessionPagePath(filters: SessionFilters) {
  const params = new URLSearchParams({ limit: '50' })
  if (filters.endpointId) params.set('endpoint_id', filters.endpointId)
  if (filters.status) params.set('status', filters.status)
  if (filters.cursor) params.set('cursor', filters.cursor)
  return `sessions?${params}`
}

export function loadSessionPage(path: string, signal: AbortSignal) {
  return readGateway(path, sessionPageSchema, signal)
}

export function loadSession(sessionId: string, signal: AbortSignal) {
  return readGateway(`sessions/${encodeURIComponent(sessionId)}`, sessionSchema, signal)
}

export function loadSessionSnapshot(sessionId: string, signal: AbortSignal) {
  return readGateway(`sessions/${encodeURIComponent(sessionId)}/snapshot`, sessionSnapshotSchema, signal)
}