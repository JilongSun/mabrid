import { z } from 'zod'
import { readJson } from '@/lib/http'

export const supportKeys = ['session_create', 'session_reopen', 'session_history', 'session_streaming', 'run_status', 'run_stop', 'compatibility_streaming'] as const
export const featureKeys = ['session_list', 'session_create', 'session_reopen', 'session_history', 'session_streaming', 'run_cancel', 'run_reconcile', 'tool_activity', 'widgets', 'compatibility_streaming', 'host_actions', 'event_replay', 'remote_session_import'] as const
const supportSchema = z.object(Object.fromEntries(supportKeys.map((key) => [key, z.boolean().nullable().optional()])) as Record<typeof supportKeys[number], z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>)
const observationSchema = z.object({
  availability: z.enum(['available', 'unavailable', 'unknown']),
  reason: z.enum(['discovery_verified', 'discovery_unsupported', 'invalid_response', 'authentication_failed', 'runtime_unavailable', 'probe_timeout', 'probe_failed']),
  checked_at: z.string().optional(), support: supportSchema.optional(),
})
const featureSchema = z.object({
  implemented: z.boolean(), enabled: z.boolean(), remote_support: z.boolean().nullable().optional(),
  availability: z.enum(['available', 'unavailable', 'unknown', 'disabled', 'unsupported']),
  reason: z.enum(['local_available', 'local_disabled', 'not_implemented', 'remote_verified', 'remote_unknown', 'remote_unsupported', 'runtime_unavailable']),
})
export const capabilitiesSchema = z.object({
  gateway: z.object({
    enabled: z.literal(true).default(true), topology_read: z.boolean(), session_inspection: z.boolean(),
    topology_mutation: z.literal(false).default(false), mcp_apps_protocol_passthrough: z.literal(true).default(true),
  }),
  agent_host: z.object({
    enabled: z.boolean(), target_id: z.string().nullable().optional(), max_concurrent_runs: z.literal(1).default(1),
    native_runtime: observationSchema.nullable().optional(), compatibility_runtime: observationSchema.nullable().optional(),
    features: z.object(Object.fromEntries(featureKeys.map((key) => [key, featureSchema])) as Record<typeof featureKeys[number], typeof featureSchema>),
  }),
})
export const targetSchema = z.object({
  target_id: z.string(), runtime_profile: z.object({ integration_kind: z.string(), interface: z.string(), capabilities: z.array(z.string()) }),
  assignment: z.object({ endpoint_id: z.uuid(), endpoint_slug: z.string(), endpoint_path: z.string(), transport: z.literal('streamable-http'), advertised_url: z.string() }),
})
export type Capabilities = z.infer<typeof capabilitiesSchema>
export type RuntimeObservation = z.infer<typeof observationSchema>
export type AgentTarget = z.infer<typeof targetSchema>
export const loadHealth = (signal: AbortSignal) => readJson('/health', z.record(z.string(), z.string()), signal, 'local process')
export const loadReadiness = (signal: AbortSignal) => readJson('/ready', z.object({ status: z.literal('ready').default('ready') }), signal, 'local readiness service')
export const loadCapabilities = (signal: AbortSignal) => readJson('/api/v1/capabilities', capabilitiesSchema, signal, 'capability service')
export const loadTarget = (signal: AbortSignal) => readJson('/api/v1/agent-host/target', targetSchema, signal, 'Target service')