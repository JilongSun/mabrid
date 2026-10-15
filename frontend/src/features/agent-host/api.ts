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
export const hostErrorSchema = z.object({
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

export const stopResponseSchema = z.object({ session_id: z.uuid(), run_id: z.uuid(), accepted: z.boolean(), settlement: z.literal('unconfirmed') })
export const reconcileResponseSchema = z.object({ session_id: z.uuid(), run_id: z.uuid(), settled: z.boolean() })
export type RunIdentity = { session_id: string; run_id: string }

async function controlHostRun<T extends RunIdentity>(identity: RunIdentity, action: 'cancel' | 'reconcile', status: number, schema: z.ZodType<T>, signal: AbortSignal) {
  if (!z.uuid().safeParse(identity.session_id).success || !z.uuid().safeParse(identity.run_id).success) throw new Error('A valid local Session and Run are required.')
  const response = await postHost(`/api/v1/host/sessions/${encodeURIComponent(identity.session_id)}/runs/${encodeURIComponent(identity.run_id)}/${action}`, undefined, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
  if (response.status !== status || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('The Host control response is invalid. Settlement is unconfirmed.')
  let body: unknown
  try { body = await response.json() } catch { throw new Error('The Host control response is invalid. Settlement is unconfirmed.') }
  const parsed = schema.safeParse(body)
  if (!parsed.success || parsed.data.session_id !== identity.session_id || parsed.data.run_id !== identity.run_id) throw new Error('The Host control response has invalid identity or settlement. Settlement is unconfirmed.')
  return parsed.data
}

export const cancelHostRun = (identity: RunIdentity, signal: AbortSignal) => controlHostRun(identity, 'cancel', 202, stopResponseSchema, signal)
export const reconcileHostRun = (identity: RunIdentity, signal: AbortSignal) => controlHostRun(identity, 'reconcile', 200, reconcileResponseSchema, signal)

export async function postHost(path: string, body: unknown, signal: AbortSignal, accept = 'application/json') {
  let response: Response
  const admission = new AbortController()
  const timer = setTimeout(() => admission.abort(), 15_000)
  try {
    response = await fetch(path, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.any([signal, admission.signal]),
      headers: { Accept: accept, 'Content-Type': 'application/json' }, cache: 'no-store',
    })
  } catch {
    throw new Error('The Host request outcome is unknown. It has not been retried.')
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim()
    if (mediaType !== 'application/json' && mediaType !== 'application/problem+json') throw new HttpError(`The Agent Host request failed (HTTP ${response.status}).`, response.status)
    let errorBody: unknown
    try { errorBody = await response.json() } catch { throw new HttpError(`The Agent Host request failed (HTTP ${response.status}).`, response.status) }
    throw hostError(errorBody, response.status)
  }
  return response
}

export async function createHostSession(title: string, signal: AbortSignal) {
  const response = await postHost('/api/v1/host/sessions', title.trim() ? { title: title.trim() } : {}, signal)
  if (response.status !== 201 || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('The Host creation response is invalid. The request has not been retried.')
  let body: unknown
  try { body = await response.json() } catch { throw new Error('The Host creation response is invalid. The request has not been retried.') }
  const parsed = hostSessionSchema.safeParse(body)
  if (!parsed.success) throw new Error('The Host creation response does not match the Session contract. The request has not been retried.')
  return parsed.data
}

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