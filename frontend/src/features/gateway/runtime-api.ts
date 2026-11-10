import { z } from 'zod'
import { HttpError, putJson } from '@/lib/http'
import { GatewayHttpError, readGateway } from './api'

const bindingSchema = z.object({
  upstream: z.string(), namespace: z.string().nullable(), priority: z.int(), enabled: z.boolean(),
})
const endpointSchema = z.object({
  displayName: z.string().nullable(), mode: z.enum(['passthrough', 'aggregate']),
  enabled: z.boolean(), bindings: z.array(bindingSchema),
})
export const runtimeFileSchema = z.object({
  content_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  upstreams: z.record(z.string(), z.object({
    transport: z.enum(['sse', 'streamable-http', 'stdio']), enabled: z.boolean(),
    url: z.string().nullable(), headers: z.array(z.string()),
  })),
  endpoints: z.record(z.string(), endpointSchema),
  agent_host: z.object({ enabled: z.boolean(), target_id: z.string().nullable(), endpoint_slug: z.string().nullable() }),
})
export type RuntimeFile = z.infer<typeof runtimeFileSchema>
export type HeaderOperation = { action: 'preserve' | 'remove' } | { action: 'replace'; value: string }
export type RuntimeFileWrite = {
  expected_hash: string | null
  upstreams: Record<string,
    | { transport: 'stdio'; enabled: boolean }
    | { transport: 'sse' | 'streamable-http'; enabled: boolean; url: string; headers: Record<string, HeaderOperation> }>
  endpoints: RuntimeFile['endpoints']
}

export const loadRuntimeFile = (signal: AbortSignal) => readGateway('configuration/runtime', runtimeFileSchema, signal)

export async function saveRuntimeFile(body: RuntimeFileWrite, signal: AbortSignal) {
  try {
    return await putJson('/api/v1/gateway/configuration/runtime', body, runtimeFileSchema, signal, 'Gateway')
  } catch (error) {
    if (error instanceof HttpError) throw new GatewayHttpError(error.message, error.status, error.code)
    throw error
  }
}