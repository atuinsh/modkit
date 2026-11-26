import * as v from 'valibot'

import type { StdioServer, Unreachable } from '@atuin/modkit-target-node/runtime/servers'

const ConfigSchema = v.object({
  disabled: v.optional(v.unknown()),
  enabled: v.optional(v.unknown()),
  type: v.optional(v.unknown()),
  command: v.fallback(v.array(v.string()), []),
  environment: v.fallback(
    v.pipe(
      v.record(v.string(), v.unknown()),
      v.transform((env) =>
        Object.fromEntries(
          Object.entries(env).flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : [],
          ),
        ),
      ),
    ),
    {},
  ),
})

export function opencodeServerOf({
  name,
  configured,
}: {
  name: string
  configured: readonly (readonly [string, unknown])[]
}): StdioServer | Unreachable {
  const config = v.safeParse(ConfigSchema, configured.find(([named]) => named === name)?.[1])
  if (!config.success) return { reason: `opencode's config names no ${name} MCP server` }
  const { disabled, enabled, type, command, environment } = config.output
  if (disabled === true || enabled === false) {
    return { reason: `${name} is turned off in opencode's config` }
  }
  if (type !== 'local') {
    return {
      reason: `${name} is a remote server, whose login is opencode's own; a mod reaches local servers only`,
    }
  }
  const [program, ...args] = command
  if (program === undefined) return { reason: `opencode's config gives ${name} no command` }
  return { command: program, args, env: environment, cwd: undefined }
}
