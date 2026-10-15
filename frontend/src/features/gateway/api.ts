import { z } from 'zod'
import { HttpError, readJson } from '@/lib/http'

const revisionSchema = z.object({
  revision_id: z.uuid(), revision_number: z.int(), created_at: z.string(),
})
const metadataSchema = z.record(z.string(), z.unknown())
const configuredKeySchema = z.object({ name: z.string(), configured: z.literal(true) })
const connectionSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('streamable-http'), url: z.string(),
    headers: z.array(configuredKeySchema), timeout_seconds: z.number(),
  }),
  z.object({ transport: z.literal('sse'), url: z.string(), headers: z.array(configuredKeySchema) }),
  z.object({
    transport: z.literal('stdio'), command: z.string(), args: z.array(z.string()),
    cwd: z.string().nullable(), env: z.array(configuredKeySchema),
  }),
])

// Validate the presentation fields consumed here; other frozen response fields are not retained.
export const topologySchema = z.object({
  endpoints: z.array(z.object({
    endpoint_id: z.uuid(),
    slug: z.string(),
    display_name: z.string(),
    mode: z.enum(['aggregate', 'passthrough']),
    enabled: z.boolean(),
    endpoint_path: z.string(),
    advertised_url: z.string().nullable(),
    current_revision: revisionSchema,
    metadata: metadataSchema,
    bindings: z.array(z.object({
      binding_id: z.uuid(),
      binding_revision_id: z.uuid(),
      upstream_server_id: z.uuid(),
      upstream_revision_id: z.uuid(),
      namespace: z.string().nullable(),
      priority: z.int(),
      enabled: z.boolean(),
    })),
  })),
  upstreams: z.array(z.object({
    server_id: z.uuid(),
    slug: z.string(),
    display_name: z.string(),
    enabled: z.boolean(),
    connection: connectionSchema,
    current_revision: revisionSchema,
    metadata: metadataSchema,
  })),
})

const publicationSchema = z.object({
  published_endpoint_slugs: z.array(z.string()),
})

export type Endpoint = z.infer<typeof topologySchema>['endpoints'][number]
export type Upstream = z.infer<typeof topologySchema>['upstreams'][number]
export type GatewaySnapshot = {
  topology: z.infer<typeof topologySchema>
  publication:
    | { kind: 'available'; slugs: string[] }
    | { kind: 'error'; message: string }
}

/** Preserve the Gateway error identity used by existing management consumers. */
export class GatewayHttpError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'GatewayHttpError'
  }
}

export async function readGateway<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await readJson(`/api/v1/gateway/${path}`, schema, signal, 'Gateway')
  } catch (error) {
    if (error instanceof HttpError) throw new GatewayHttpError(error.message, error.status)
    throw error
  }
}

export async function loadGatewaySnapshot(signal: AbortSignal): Promise<GatewaySnapshot> {
  const [topology, publication] = await Promise.all([
    readGateway('topology', topologySchema, signal),
    readGateway('status', publicationSchema, signal).then(
      (status): GatewaySnapshot['publication'] => ({
        kind: 'available',
        slugs: status.published_endpoint_slugs,
      }),
      (error: unknown): GatewaySnapshot['publication'] => {
        if (signal.aborted) throw error
        return {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unable to read Gateway publication status.',
        }
      },
    ),
  ])
  return { topology, publication }
}
