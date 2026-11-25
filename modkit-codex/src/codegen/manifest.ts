import type { ModInfo } from '@atuin/modkit-target'

import { serverNameOf } from '../runtime/names.ts'

const PASSED_ALWAYS = ['CODEX_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'] as const

export function pluginJsonOf({ plugin, mod }: { plugin: string; mod: ModInfo }): unknown {
  return {
    name: plugin,
    version: mod.version,
    description: mod.description,
    mcpServers: './.mcp.json',
    hooks: './hooks/hooks.json',
    ...(mod.author !== undefined && { interface: { developerName: mod.author.name } }),
  }
}

export function mcpJsonOf({ plugin, env }: { plugin: string; env: readonly string[] }): unknown {
  return {
    mcpServers: {
      [serverNameOf(plugin)]: {
        command: 'node',
        args: ['./server.mjs'],
        cwd: '.',
        env_vars: [...new Set([...env, ...PASSED_ALWAYS])].toSorted(),
      },
    },
  }
}
