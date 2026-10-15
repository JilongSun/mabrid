import { createParser } from 'eventsource-parser'
import { z } from 'zod'
import { hostErrorSchema, postHost } from './api'

const jsonObject = z.record(z.string(), z.unknown())
const toolResult = z.object({ content: z.array(jsonObject).default([]), structured_content: jsonObject.nullable().optional(), is_error: z.boolean().default(false), metadata: jsonObject.optional() })
const invocation = { tool_invocation_id: z.uuid(), tool_name: z.string() }
export const runEventSchema = z.object({
  event_id: z.uuid(), session_id: z.uuid(), run_id: z.uuid(), sequence: z.int().positive(), created_at: z.iso.datetime({ offset: true }),
  event: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('run.started'), target_id: z.string() }),
    z.object({ kind: z.literal('assistant.text.delta'), delta: z.string() }),
    z.object({ kind: z.literal('assistant.text.completed'), text: z.string() }),
    z.object({ kind: z.literal('run.completed'), output_text: z.string(), usage: z.object({ input_tokens: z.int().nonnegative().default(0), output_tokens: z.int().nonnegative().default(0) }) }),
    z.object({ kind: z.literal('run.cancelled') }),
    z.object({ kind: z.literal('run.failed'), error: hostErrorSchema }),
    z.object({ kind: z.literal('tool.started'), ...invocation, arguments: jsonObject }),
    z.object({ kind: z.literal('tool.completed'), ...invocation, result: toolResult }),
    z.object({ kind: z.literal('tool.failed'), ...invocation, error_code: z.string(), error_message: z.string(), result: toolResult.nullable().optional() }),
    z.object({ kind: z.literal('widget.created'), widget: z.object({
      widget_id: z.uuid(), ...invocation, tool_result: toolResult, application_resource_uri: z.string(), resource_metadata: jsonObject,
      resource_contents: z.array(z.object({ uri: z.string(), mime_type: z.string().nullable().optional(), text: z.string().nullable().optional(), blob: z.string().nullable().optional(), metadata: jsonObject.optional() })),
    }) }),
    z.object({ kind: z.literal('widget.failed'), ...invocation, tool_result: toolResult, application_resource_uri: z.string(), error_message: z.string() }),
  ]),
})
export type RunEvent = z.infer<typeof runEventSchema>
export const terminalEvent = (event: RunEvent) => ['run.completed', 'run.cancelled', 'run.failed'].includes(event.event.kind)

/** Own one POST-SSE request; never reconnect or resubmit an admitted or uncertain Run. */
export async function streamHostRun(sessionId: string, inputText: string, signal: AbortSignal, receive: (event: RunEvent) => void) {
  if (!z.uuid().safeParse(sessionId).success || !inputText.trim()) throw new Error('A valid Session and nonblank input are required.')
  const response = await postHost(`/api/v1/host/sessions/${encodeURIComponent(sessionId)}/runs`, { input_text: inputText }, signal, 'text/event-stream, application/json')
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim() !== 'text/event-stream' || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new Error('The Host stream response is invalid. Run outcome is unknown.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let sequence = 0
  let runId: string | null = null
  let terminal = false
  const eventIds = new Set<string>()
  const parser = createParser({
    onEvent(frame) {
      if (terminal) throw new Error('The Host sent data after a terminal event.')
      let body: unknown
      try { body = JSON.parse(frame.data) } catch { throw new Error('The Host sent invalid stream JSON.') }
      const parsed = runEventSchema.safeParse(body)
      if (!parsed.success) throw new Error('The Host stream does not match the event contract.')
      const event = parsed.data
      if (event.session_id !== sessionId || runId !== null && event.run_id !== runId || event.sequence !== sequence + 1 || eventIds.has(event.event_id) || frame.id !== event.event_id || frame.event !== event.event.kind || sequence === 0 && event.event.kind !== 'run.started' || sequence > 0 && event.event.kind === 'run.started') throw new Error('The Host stream has invalid identity or event ordering.')
      runId = event.run_id
      sequence = event.sequence
      eventIds.add(event.event_id)
      terminal = terminalEvent(event)
      receive(event)
    },
    onError(error) { if (error.type === 'max-buffer-size-exceeded') throw new Error('The Host stream frame is too large.') },
    maxBufferSize: 8 * 1024 * 1024,
  })
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (signal.aborted) throw new Error('The stream was closed. Run outcome is unknown.')
    while (!terminal) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try { chunk = await reader.read() } catch { throw new Error('The Host stream disconnected. Run outcome is unknown.') }
      if (chunk.done) {
        parser.feed(decoder.decode())
        if (!terminal) throw new Error('The stream ended without a terminal event. Run outcome is unknown.')
      } else parser.feed(decoder.decode(chunk.value, { stream: true }))
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}