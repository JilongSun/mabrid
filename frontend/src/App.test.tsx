import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('workspace navigation', () => {
  it('starts on Gateway Endpoints without reporting an empty or healthy backend', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Gateway' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Endpoints' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(/Endpoint data has not been loaded/)).toBeDefined()
  })

  it('preserves the selected Gateway view when switching workspaces', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'MCP Sessions' }))
    const navigation = within(screen.getByRole('navigation', { name: 'Product navigation' }))
    await user.click(navigation.getByRole('button', { name: 'Agent Host' }))
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    expect(screen.queryByRole('tab', { name: 'Endpoints' })).toBeNull()
    await user.click(navigation.getByRole('button', { name: 'Connection & capabilities' }))
    expect(screen.getByText(/No service health is reported/)).toBeDefined()
    await user.click(navigation.getByRole('button', { name: 'Gateway' }))
    expect(screen.getByRole('tab', { name: 'MCP Sessions' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps collapsed navigation named and functional', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Agent Host' }))
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }))
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeDefined()
  })

  it('closes mobile navigation after selection and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(<App />)
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    const dialog = within(screen.getByRole('dialog', { name: 'Mabrid' }))
    await user.click(dialog.getByRole('button', { name: 'Agent Host' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Agent Host' })).toBeDefined()
    expect(document.activeElement).toBe(trigger)
  })

  it('supports keyboard switching between Gateway views', async () => {
    const user = userEvent.setup()
    render(<App />)
    screen.getByRole('tab', { name: 'Endpoints' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Upstreams' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Upstreams' })).toBeDefined()
  })
})
