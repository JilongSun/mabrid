import { useEffect, useState } from 'react'
import { GatewayHttpError } from './api'
import { loadSessionEvents, type SessionEvent } from './sessions-api'

type EventState = {
  items: SessionEvent[]
  nextAfter: number | null
  loaded: boolean
  loadedAt: string | null
  error: string | null
  notFound: boolean
  revision: number
}

export function useSessionEvents(sessionId: string | null) {
  const [cache, setCache] = useState<Record<string, EventState>>({})
  const [request, setRequest] = useState({ sessionId, after: 0, revision: 0 })
  const cached = sessionId ? cache[sessionId] : undefined
  if (request.sessionId !== sessionId) setRequest({
    sessionId, after: cached?.items.at(-1)?.sequence ?? 0, revision: request.revision + 1,
  })
  const pending = Boolean(sessionId && cached?.revision !== request.revision)

  useEffect(() => {
    if (!sessionId || request.sessionId !== sessionId) return
    const controller = new AbortController()
    loadSessionEvents(sessionId, request.after, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setCache((previous) => {
          const items = new Map((previous[sessionId]?.items ?? []).map((item) => [item.sequence, item]))
          for (const item of page.items) items.set(item.sequence, item)
          return { ...previous, [sessionId]: {
            items: [...items.values()].toSorted((first, second) => first.sequence - second.sequence),
            nextAfter: page.next_after, loaded: true, loadedAt: new Date().toISOString(),
            error: null, notFound: false, revision: request.revision,
          } }
        })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setCache((previous) => ({ ...previous, [sessionId]: {
          items: previous[sessionId]?.items ?? [], nextAfter: previous[sessionId]?.nextAfter ?? null,
          loaded: previous[sessionId]?.loaded ?? false, loadedAt: previous[sessionId]?.loadedAt ?? null,
          error: error instanceof Error ? error.message : 'Unable to read Session events.',
          notFound: error instanceof GatewayHttpError && error.status === 404, revision: request.revision,
        } }))
      },
    )
    return () => controller.abort()
  }, [request.after, request.revision, request.sessionId, sessionId])

  const readMore = () => setRequest((previous) => ({
    sessionId, after: cached?.nextAfter ?? cached?.items.at(-1)?.sequence ?? 0, revision: previous.revision + 1,
  }))
  return {
    items: cached?.items ?? [], nextAfter: cached?.nextAfter ?? null,
    loaded: cached?.loaded ?? false, loadedAt: cached?.loadedAt ?? null,
    pending, error: pending ? null : cached?.error ?? null, notFound: !pending && Boolean(cached?.notFound),
    refresh: readMore,
  }
}