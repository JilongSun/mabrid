import { z } from 'zod'
import { HttpError, readJson } from '@/lib/http'

export const hostSessionSchema = z.object({
  session_id: z.uuid(), target_id: z.string().min(1), title: z.string().nullable().optional(), created_at: z.string(),
  binding_state: z.enum(['unknown', 'available', 'missing', 'runtime_changed', 'unavailable']),
  target_run: z.object({ session_id: z.uuid(), run_id: z.uuid(), state: z.enum(['active', 'unsettled']) }).nullable().optional(),
})
export const hostSessionPageSchema = z.object({ sessions: z.array(hostSessionSchema), limit: z.int().min(1).max(200), offset: z.int().nonnegative(), has_more: z.boolean() })
export const historyQuerySchema = z.object({ limit: z.int().min(1).max(500).default(100), offset: z.int().nonnegative().default(0), order: z.enum(['latest', 'oldest']).default('latest') })
export const historySchema = z.object({
  session_id: z.uuid(), query: historyQuerySchema, has_more: z.boolean().nullable().optional(),
  messages: z.array(z.object({
    message_id: z.string().min(1), role: z.enum(['system', 'developer', 'user', 'assistant', 'tool', 'unsupported']),
    created_at: z.string().nullable().optional(), tool_call_id: z.string().nullable().optional(), tool_name: z.string().nullable().optional(),
    content: z.array(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), text: z.string() }),
      z.object({ kind: z.literal('tool_call'), tool_call_id: z.string().min(1), tool_name: z.string().min(1), arguments: z.record(z.string(), z.unknown()) }),
      z.object({ kind: z.literal('unsupported'), content_type: z.string().min(1) }),
    ])),
  })),
})
const hostErrorSchema = z.object({
  code: z.enum(['invalid_request', 'run_not_found', 'internal_error', 'session_not_found', 'remote_session_not_found', 'runtime_binding_changed', 'runtime_unavailable', 'runtime_contract_error', 'target_busy', 'unsupported_operation', 'run_state_unknown']),
  message: z.string(),
})

/** Preserve safe Host failure codes without relying on rendered message matching. */
export class HostHttpError extends HttpError {
  readonly code: z.infer<typeof hostErrorSchema>['code']
  constructor(message: string, status: number, code: z.infer<typeof hostErrorSchema>['code']) {
    super(message, status)
    this.name = 'HostHttpError'
    this.code = code
  }
}

function hostError(body: unknown, status: number) {
  const parsed = hostErrorSchema.safeParse(body)
  return parsed.success ? new HostHttpError(parsed.data.message, status, parsed.data.code) : new HttpError(`The Agent Host request failed (HTTP ${status}).`, status)
}

export type HostSession = z.infer<typeof hostSessionSchema>
export type HistoryPage = z.infer<typeof historySchema>
export type HistoryQuery = z.infer<typeof historyQuerySchema>

export async function loadHostSessions(offset: number, signal: AbortSignal) {
  const page = await readJson(`/api/v1/host/sessions?${new URLSearchParams({ limit: '20', offset: String(offset) })}`, hostSessionPageSchema, signal, 'Agent Host', hostError)
  if (page.offset !== offset || page.limit !== 20 || page.sessions.length > 20 || page.has_more && page.sessions.length === 0) throw new Error('The Agent Host returned an invalid Session page boundary.')
  return page
}

export function loadHostSession(sessionId: string, signal: AbortSignal) {
  return readJson(`/api/v1/host/sessions/${encodeURIComponent(sessionId)}`, hostSessionSchema, signal, 'Agent Host', hostError).then((session) => {
    if (session.session_id !== sessionId) throw new Error('The Agent Host returned another Session.')
    return session
  })
}

export async function loadHostHistory(sessionId: string, query: HistoryQuery, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset), order: query.order })
  const page = await readJson(`/api/v1/host/sessions/${encodeURIComponent(sessionId)}/history?${params}`, historySchema, signal, 'Agent Host', hostError)
  if (page.session_id !== sessionId || page.query.limit !== query.limit || page.query.offset !== query.offset || page.query.order !== query.order || page.messages.length > query.limit || new Set(page.messages.map((message) => message.message_id)).size !== page.messages.length) {
    throw new Error('The Agent Host returned history for another Session or an invalid page boundary.')
  }
  return page
}