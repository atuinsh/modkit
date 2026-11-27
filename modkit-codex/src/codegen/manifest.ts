import type { ModInfo } from '@atuin/modkit-target'

import {
  HOOK_TOOL,
  hookInputOf,
  hookTimeoutOf,
  serverNameOf,
  SHELL_TOOL,
  type HookEventName,
} from '../protocol.ts'

const PASSED_ALWAYS = ['CODEX_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'] as const

interface CodexPluginManifest {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly mcpServers: string
  readonly hooks: string
  readonly interface?: { readonly developerName: string }
}

interface CodexMcpConfig {
  readonly mcpServers: Readonly<
    Record<
      string,
      {
        readonly command: string
        readonly args: readonly string[]
        readonly cwd: string
        readonly env_vars: readonly string[]
      }
    >
  >
}

interface CodexHook {
  readonly type: 'mcp_tool'
  readonly server: string
  readonly tool: string
  readonly input: Readonly<Record<string, string>>
  readonly timeout?: number
}

interface CodexHookEntry {
  readonly matcher?: string
  readonly hooks: readonly CodexHook[]
}

interface CodexHooksConfig {
  readonly hooks: Readonly<Partial<Record<HookEventName, readonly CodexHookEntry[]>>>
}

export interface CodexManifests {
  readonly plugin: CodexPluginManifest
  readonly mcp: CodexMcpConfig
  readonly hooks: CodexHooksConfig
}

function matcherOf(tool: string): string {
  // Codex compares a matcher of letters, digits and `_` as written, and reads any other as an
  // unanchored regex, which `mcp__my-server__x` would match more than one tool with.
  if (/^\w+$/u.test(tool)) return tool
  return `^${tool.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}$`
}

function hookFor({ plugin, event }: { plugin: string; event: HookEventName }): CodexHook {
  const timeout = hookTimeoutOf(event)
  return {
    type: 'mcp_tool',
    server: serverNameOf(plugin),
    tool: HOOK_TOOL,
    input: hookInputOf(event),
    ...(timeout !== undefined && { timeout }),
  }
}

function hooksConfigOf({
  plugin,
  hasBeforeShell,
  tools,
}: {
  plugin: string
  hasBeforeShell: boolean
  tools: { before: readonly string[]; after: readonly string[] }
}): CodexHooksConfig {
  const on = (event: HookEventName): readonly CodexHookEntry[] => [
    { hooks: [hookFor({ plugin, event })] },
  ]
  const preHook = hookFor({ plugin, event: 'PreToolUse' })
  const postHook = hookFor({ plugin, event: 'PostToolUse' })
  const before = [
    ...(hasBeforeShell ? [SHELL_TOOL] : []),
    ...tools.before.filter((tool) => tool !== SHELL_TOOL),
  ]
  // The shell is always hooked after: a query that refreshes on `shell.after` needs it even in a
  // mod with no `afterShell`.
  const after = [SHELL_TOOL, ...tools.after.filter((tool) => tool !== SHELL_TOOL)]
  return {
    hooks: {
      SessionStart: on('SessionStart'),
      UserPromptSubmit: on('UserPromptSubmit'),
      ...(before.length > 0 && {
        PreToolUse: before.map((tool) => ({ matcher: matcherOf(tool), hooks: [preHook] })),
      }),
      PostToolUse: after.map((tool) => ({ matcher: matcherOf(tool), hooks: [postHook] })),
      Stop: on('Stop'),
    },
  }
}

export function manifestsOf({
  plugin,
  mod,
  env,
  hasBeforeShell,
  tools,
}: {
  plugin: string
  mod: ModInfo
  env: readonly string[]
  hasBeforeShell: boolean
  tools: { before: readonly string[]; after: readonly string[] }
}): CodexManifests {
  return {
    plugin: {
      name: plugin,
      version: mod.version,
      description: mod.description,
      mcpServers: './.mcp.json',
      hooks: './hooks/hooks.json',
      ...(mod.author !== undefined && { interface: { developerName: mod.author.name } }),
    },
    mcp: {
      mcpServers: {
        [serverNameOf(plugin)]: {
          command: 'node',
          args: ['./server.mjs'],
          cwd: '.',
          env_vars: [...new Set([...env, ...PASSED_ALWAYS])].toSorted(),
        },
      },
    },
    hooks: hooksConfigOf({ plugin, hasBeforeShell, tools }),
  }
}
