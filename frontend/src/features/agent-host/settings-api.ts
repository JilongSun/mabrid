import { z } from 'zod'
import { postJson, putJson, readJson } from '@/lib/http'

const hash = z.string().regex(/^[a-f0-9]{64}$/).nullable()
const httpUrl = z.url({ protocol: /^https?$/ })
export const hostSettingsSchema = z.object({
  enabled: z.boolean(), mcpAppsEnabled: z.boolean(),
  targetId: z.string().min(1).nullable(), endpointSlug: z.string().regex(/^[a-z][a-z0-9-]*$/).nullable(),
  runtime: z.object({
    integration: z.literal('hermes'), interface: z.literal('openai-chat-completions'),
    baseUrl: httpUrl, apiKeyEnv: z.string().min(1), timeoutSeconds: z.number().positive(),
    sessions: z.object({ apiRoot: httpUrl, bindingId: z.string().min(1) }).nullable(),
  }),
}).superRefine((value, context) => {
  if (value.enabled && (!value.targetId || !value.endpointSlug)) context.addIssue({ code: 'custom', message: 'An enabled Host requires a Target ID and endpoint.' })
  if (value.mcpAppsEnabled && !value.enabled) context.addIssue({ code: 'custom', message: 'MCP Apps requires an enabled Host.' })
})
export const hostSettingsFileSchema = z.object({ content_hash: hash, agent_host: hostSettingsSchema, published_endpoints: z.array(z.string()) })
export const hostSettingsStatusSchema = z.object({
  applied_hash: hash, desired_hash: hash, file_hash: hash, applied_at: z.string().nullable(),
  enabled: z.boolean(), file_valid: z.boolean(), pending: z.boolean(), busy: z.boolean(), error: z.string().nullable(),
})
export type HostSettingsFile = z.infer<typeof hostSettingsFileSchema>
export type HostSettingsStatus = z.infer<typeof hostSettingsStatusSchema>
export type HostSettingsDraft = {
  enabled: boolean; mcpAppsEnabled: boolean; targetId: string; endpointSlug: string;
  baseUrl: string; apiKeyEnv: string; timeoutSeconds: string; native: boolean; apiRoot: string; bindingId: string;
}
export function hostSettingsDraft(file: HostSettingsFile): HostSettingsDraft {
  const host = file.agent_host
  return {
    enabled: host.enabled, mcpAppsEnabled: host.mcpAppsEnabled, targetId: host.targetId ?? '', endpointSlug: host.endpointSlug ?? '',
    baseUrl: host.runtime.baseUrl, apiKeyEnv: host.runtime.apiKeyEnv, timeoutSeconds: String(host.runtime.timeoutSeconds),
    native: host.runtime.sessions !== null, apiRoot: host.runtime.sessions?.apiRoot ?? '', bindingId: host.runtime.sessions?.bindingId ?? '',
  }
}
export function hostSettingsRequest(draft: HostSettingsDraft, expectedHash: string | null) {
  const result = hostSettingsSchema.safeParse({
    enabled: draft.enabled, mcpAppsEnabled: draft.mcpAppsEnabled,
    targetId: draft.targetId || null, endpointSlug: draft.endpointSlug || null,
    runtime: {
      integration: 'hermes', interface: 'openai-chat-completions',
      baseUrl: draft.baseUrl.trim(), apiKeyEnv: draft.apiKeyEnv, timeoutSeconds: Number(draft.timeoutSeconds),
      sessions: draft.native ? { apiRoot: draft.apiRoot.trim(), bindingId: draft.bindingId } : null,
    },
  })
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid Host settings.')
  return { expected_hash: expectedHash, agent_host: result.data }
}
const path = '/api/v1/agent-host/configuration'
export const loadHostSettings = (signal: AbortSignal) => readJson(`${path}/runtime`, hostSettingsFileSchema, signal, 'Host configuration')
export const loadHostSettingsStatus = (signal: AbortSignal) => readJson(path, hostSettingsStatusSchema, signal, 'Host configuration')
export const saveHostSettings = (body: ReturnType<typeof hostSettingsRequest>, signal: AbortSignal) => putJson(`${path}/runtime`, body, hostSettingsFileSchema, signal, 'Host configuration')
export const applyHostSettings = (expectedHash: string | null, signal: AbortSignal) => postJson(`${path}/apply`, { expected_hash: expectedHash }, hostSettingsStatusSchema, signal, 'Host configuration')