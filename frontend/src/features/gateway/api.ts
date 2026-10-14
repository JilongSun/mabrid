import { z } from 'zod'

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

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  detail: z.string(),
  code: z.string(),
})

export type Endpoint = z.infer<typeof topologySchema>['endpoints'][number]
export type Upstream = z.infer<typeof topologySchema>['upstreams'][number]
export type GatewaySnapshot = {
  topology: z.infer<typeof topologySchema>
  publication:
    | { kind: 'available'; slugs: string[] }
    | { kind: 'error'; message: string }
}

/** Preserve the HTTP failure status for management views without parsing display messages. */
export class GatewayHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'GatewayHttpError'
    this.status = status
  }
}

export async function readGateway<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(10_000)
  let response: Response
  try {
    response = await fetch(`/api/v1/gateway/${path}`, {
      signal: AbortSignal.any([signal, timeout]),
      headers: { Accept: 'application/json, application/problem+json' },
      cache: 'no-store',
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.aborted) throw new Error('The Gateway request timed out. Try refreshing.')
    if (error instanceof TypeError) {
      throw new Error('Cannot reach the Gateway. Check the backend connection and try again.')
    }
    throw error
  }

  const mediaType = response.headers.get('content-type')?.split(';')[0].trim()
  if (mediaType !== 'application/json' && mediaType !== 'application/problem+json') {
    throw new Error(`The Gateway returned a non-JSON response (HTTP ${response.status}). Check the API connection.`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.aborted) throw new Error('The Gateway request timed out. Try refreshing.')
    if (error instanceof SyntaxError) throw new Error('The Gateway returned invalid JSON.')
    throw error
  }

  if (!response.ok) {
    const problem = problemSchema.safeParse(body)
    if (problem.success) {
      throw new GatewayHttpError(`${problem.data.detail} (${problem.data.code}, HTTP ${response.status})`, response.status)
    }
    throw new GatewayHttpError(`The Gateway request failed (HTTP ${response.status}).`, response.status)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new Error('The Gateway response does not match the expected contract.')
  return parsed.data
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
