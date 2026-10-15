import { useEffect, useState } from 'react'

/** Cache read-only Host resources by identity and ignore results after navigation. */
export function useHostRead<Data>(key: string | null, load: (key: string, signal: AbortSignal) => Promise<Data>) {
  const [cache, setCache] = useState<Record<string, { data: Data | null; loadedAt: string | null; error: Error | null; revision: number }>>({})
  const [request, setRequest] = useState({ key, revision: 0 })
  if (key !== request.key) setRequest({ key, revision: request.revision + 1 })
  const cached = key ? cache[key] : undefined
  const pending = Boolean(key && cached?.revision !== request.revision)
  useEffect(() => {
    if (!key || request.key !== key) return
    const controller = new AbortController()
    load(key, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setCache((previous) => ({ ...previous, [key]: { data, loadedAt: new Date().toISOString(), error: null, revision: request.revision } })) },
      (error: unknown) => { if (!controller.signal.aborted) setCache((previous) => ({ ...previous, [key]: {
        data: previous[key]?.data ?? null, loadedAt: previous[key]?.loadedAt ?? null,
        error: error instanceof Error ? error : new Error('Unable to read Agent Host data.'), revision: request.revision,
      } })) },
    )
    return () => controller.abort()
  }, [key, load, request.key, request.revision])
  return {
    data: cached?.data ?? null, loadedAt: cached?.loadedAt ?? null, error: pending ? null : cached?.error ?? null, pending,
    refresh: () => setRequest((previous) => ({ key, revision: previous.revision + 1 })),
  }
}