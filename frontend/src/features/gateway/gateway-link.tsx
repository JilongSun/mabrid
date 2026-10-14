import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { gatewayObjectPath } from './gateway-navigation'

export function GatewayLink({ kind, objectId, id, children, className }: {
  kind: 'endpoint' | 'upstream'
  objectId: string
  id: string
  children: ReactNode
  className?: string
}) {
  const location = useLocation()
  return <Link id={id} to={gatewayObjectPath(kind, objectId)} state={{
    returnTo: location.pathname + location.search, focusHeading: true,
  }} className={className ?? 'max-w-full break-words text-left underline-offset-4 hover:underline focus-visible:outline-ring'}>{children}</Link>
}