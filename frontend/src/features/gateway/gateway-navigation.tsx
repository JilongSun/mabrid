import { useLayoutEffect, useEffect, useRef, type RefObject } from 'react'
import { matchRoutes, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'

export type GatewayView = 'endpoints' | 'upstreams' | 'topology'
export type GatewaySelection = { kind: 'endpoint' | 'upstream' | 'binding'; id: string }
export type NavigateGateway = (view: GatewayView, selection: GatewaySelection) => void

const routes: { path: string; handle: { view: GatewayView; kind?: 'endpoint' | 'upstream' } }[] = [
  { path: '/', handle: { view: 'topology' } },
  { path: '/gateway', handle: { view: 'topology' } },
  { path: '/gateway/topology', handle: { view: 'topology' } },
  { path: '/gateway/endpoints', handle: { view: 'endpoints' } },
  { path: '/gateway/endpoints/:id', handle: { view: 'endpoints', kind: 'endpoint' } },
  { path: '/gateway/upstreams', handle: { view: 'upstreams' } },
  { path: '/gateway/upstreams/:id', handle: { view: 'upstreams', kind: 'upstream' } },
]

export function gatewayObjectPath(kind: 'endpoint' | 'upstream', id: string) {
  return `/gateway/${kind === 'endpoint' ? 'endpoints' : 'upstreams'}/${encodeURIComponent(id)}`
}

export function useGatewayNavigation(heading: RefObject<HTMLHeadingElement | null>, ready: boolean) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const [params, setParams] = useSearchParams()
  const match = matchRoutes(routes, location)?.at(-1)
  const found = Boolean(match)
  const view = match?.route.handle.view ?? 'topology'
  const kind = match?.route.handle.kind
  const selected = params.get('selected')
  const objectId = params.get('object')
  const selection: GatewaySelection | null = objectId && (selected === 'endpoint' || selected === 'upstream' || selected === 'binding')
    ? { kind: selected, id: objectId } : null
  const configuration = params.get('configuration')
  const savedPaths = useRef<Record<GatewayView, string>>({
    topology: '/gateway/topology', endpoints: '/gateway/endpoints', upstreams: '/gateway/upstreams',
  })
  const positions = useRef(new Map<string, { y: number; focusId: string }>())
  const previousPath = useRef(location.pathname)

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/gateway') navigate('/gateway/topology', { replace: true })
    if (found && !kind && location.pathname === `/gateway/${view}`) savedPaths.current[view] = location.pathname + location.search
  }, [found, kind, location.pathname, location.search, navigate, view])

  useLayoutEffect(() => {
    if (!found) return
    const save = () => positions.current.set(location.key, {
      y: window.scrollY, focusId: document.activeElement?.id ?? '',
    })
    const existing = positions.current.get(location.key)
    if (!existing) save()
    window.addEventListener('scroll', save, { passive: true })
    document.addEventListener('focusin', save)
    return () => {
      window.removeEventListener('scroll', save)
      document.removeEventListener('focusin', save)
    }
  }, [found, location.key])

  useLayoutEffect(() => {
    if (!ready || !found) return
    const position = positions.current.get(location.key)
    const changedPath = previousPath.current !== location.pathname
    previousPath.current = location.pathname
    if (navigationType === 'POP' && position) {
      const target = document.getElementById(position.focusId)
      if (target) target.focus({ preventScroll: true })
      else if (kind) heading.current?.focus({ preventScroll: true })
      window.scrollTo(0, position.y)
    } else if (location.state?.focusHeading || kind && navigationType === 'POP') {
      heading.current?.focus({ preventScroll: true })
      if (navigationType !== 'POP') window.scrollTo(0, 0)
    } else if (changedPath && navigationType !== 'POP') window.scrollTo(0, 0)
  }, [found, heading, kind, location.key, location.pathname, location.state, navigationType, ready])

  const selectObject: NavigateGateway = (destination, target) => {
    const path = destination === 'topology'
      ? `/gateway/topology?${new URLSearchParams({ selected: target.kind, object: target.id })}`
      : gatewayObjectPath(target.kind === 'endpoint' ? 'endpoint' : 'upstream', target.id)
    navigate(path, { state: { returnTo: location.pathname + location.search, focusHeading: true } })
  }
  const returnTo = typeof location.state?.returnTo === 'string' && matchRoutes(routes, location.state.returnTo)
    ? location.state.returnTo : null

  return {
    view, kind, objectId: match?.params.id, selection, found,
    query: params.get('q') ?? '',
    configuration: configuration === 'enabled' || configuration === 'disabled' ? configuration : 'all',
    selectTab: (destination: GatewayView) => navigate(savedPaths.current[destination]),
    selectObject,
    selectTopology: (target: GatewaySelection | null) => setParams(target ? { selected: target.kind, object: target.id } : {}, { replace: true }),
    changeFilter: (name: 'q' | 'configuration', value: string) => setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value && value !== 'all') next.set(name, value)
      else next.delete(name)
      return next
    }, { replace: true }),
    backLabel: returnTo ? 'Back' : `Back to ${view}`,
    back: () => returnTo ? navigate(-1) : navigate(`/gateway/${view}`, { replace: true }),
  }
}