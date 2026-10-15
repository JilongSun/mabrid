import { z } from 'zod'

const problemSchema = z.object({
  type: z.string(), title: z.string(), status: z.int(), detail: z.string(), code: z.string(),
})

/** Preserve HTTP status separately from human-readable diagnostic messages. */
export class HttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export async function readJson<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal, service: string, errorFromBody?: (body: unknown, status: number) => Error): Promise<T> {
  const timeout = AbortSignal.timeout(10_000)
  let response: Response
  try {
    response = await fetch(path, {
      signal: AbortSignal.any([signal, timeout]),
      headers: { Accept: 'application/json, application/problem+json' }, cache: 'no-store',
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.aborted) throw new Error(`The ${service} request timed out. Try refreshing.`)
    if (error instanceof TypeError) throw new Error(`Cannot reach the ${service}. Check the backend connection and try again.`)
    throw error
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim()
  if (mediaType !== 'application/json' && mediaType !== 'application/problem+json') {
    throw new Error(`The ${service} returned a non-JSON response (HTTP ${response.status}). Check the API connection.`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.aborted) throw new Error(`The ${service} request timed out. Try refreshing.`)
    if (error instanceof SyntaxError) throw new Error(`The ${service} returned invalid JSON.`)
    throw error
  }
  if (!response.ok) {
    if (errorFromBody) throw errorFromBody(body, response.status)
    const problem = problemSchema.safeParse(body)
    throw new HttpError(problem.success
      ? `${problem.data.detail} (${problem.data.code}, HTTP ${response.status})`
      : `The ${service} request failed (HTTP ${response.status}).`, response.status)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new Error(`The ${service} response does not match the expected contract.`)
  return parsed.data
}