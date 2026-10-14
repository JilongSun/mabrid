import { z } from 'zod'

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
    bindings: z.array(z.object({
      binding_id: z.uuid(),
      upstream_server_id: z.uuid(),
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
export type GatewaySnapshot = {
  topology: z.infer<typeof topologySchema>
  publication:
    | { kind: 'available'; slugs: string[] }
    | { kind: 'error'; message: string }
}

async function readGateway<T>(
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
      throw new Error(`${problem.data.detail} (${problem.data.code}, HTTP ${response.status})`)
    }
    throw new Error(`The Gateway request failed (HTTP ${response.status}).`)
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
