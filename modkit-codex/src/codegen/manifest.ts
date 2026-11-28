import type { ArtifactWriter, HookNeeds, ModInfo, PluginName } from '@atuin/modkit-target'

import { HOOK_TOOL, hookInputTemplate, hookTimeout, type HookEventName } from '../protocol.ts'

const PASSED_ALWAYS = ['CODEX_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'] as const

interface PluginJson {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly mcpServers: string
  readonly hooks: string
  readonly interface?: { readonly developerName: string }
}

interface McpJson {
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

interface HooksJson {
  readonly hooks: Readonly<Partial<Record<HookEventName, readonly CodexHookEntry[]>>>
}

function escapeMatcher(tool: string): string {
  // Codex compares a matcher of letters, digits and `_` as written, and reads any other as an
  // unanchored regex, which `mcp__my-server__x` would match more than one tool with.
  if (/^\w+$/u.test(tool)) return tool
  return `^${tool.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}$`
}

function buildHook({ server, event }: { server: string; event: HookEventName }): CodexHook {
  const timeout = hookTimeout(event)
  return {
    type: 'mcp_tool',
    server,
    tool: HOOK_TOOL,
    input: hookInputTemplate(event),
    ...(timeout !== undefined && { timeout: timeout.seconds }),
  }
}

function buildHooksJson({
  server,
  hooks,
}: {
  server: string
  hooks: Pick<HookNeeds, 'before' | 'after'>
}): HooksJson {
  const on = (event: HookEventName): readonly CodexHookEntry[] => [
    { hooks: [buildHook({ server, event })] },
  ]
  const preHook = buildHook({ server, event: 'PreToolUse' })
  const postHook = buildHook({ server, event: 'PostToolUse' })
  return {
    hooks: {
      SessionStart: on('SessionStart'),
      UserPromptSubmit: on('UserPromptSubmit'),
      ...(hooks.before.length > 0 && {
        PreToolUse: hooks.before.map((tool) => ({
          matcher: escapeMatcher(tool),
          hooks: [preHook],
        })),
      }),
      ...(hooks.after.length > 0 && {
        PostToolUse: hooks.after.map((tool) => ({
          matcher: escapeMatcher(tool),
          hooks: [postHook],
        })),
      }),
      Stop: on('Stop'),
    },
  }
}

/** Typed Codex plugin manifests (`.codex-plugin/plugin.json`, `.mcp.json`, `hooks/hooks.json`). */
export class CodexPluginManifest {
  readonly #plugin: PluginJson
  readonly #mcp: McpJson
  readonly #hooks: HooksJson

  private constructor({
    plugin,
    mcp,
    hooks,
  }: {
    plugin: PluginJson
    mcp: McpJson
    hooks: HooksJson
  }) {
    this.#plugin = plugin
    this.#mcp = mcp
    this.#hooks = hooks
  }

  /** Construct all Codex plugin manifests from compiled mod metadata and hook needs. */
  static build({
    plugin,
    mod,
    env,
    hooks,
  }: {
    plugin: PluginName
    mod: ModInfo
    env: readonly string[]
    hooks: HookNeeds
  }): CodexPluginManifest {
    const server = plugin.serverName()
    return new CodexPluginManifest({
      plugin: {
        name: plugin.toString(),
        version: mod.version,
        description: mod.description,
        mcpServers: './.mcp.json',
        hooks: './hooks/hooks.json',
        ...(mod.author !== undefined && { interface: { developerName: mod.author.name } }),
      },
      mcp: {
        mcpServers: {
          [server]: {
            command: 'node',
            args: ['./server.mjs'],
            cwd: '.',
            env_vars: [...new Set([...env, ...PASSED_ALWAYS])].toSorted(),
          },
        },
      },
      hooks: buildHooksJson({ server, hooks }),
    })
  }

  /** Emit all three manifest JSON files through `emit`. */
  emitTo(emit: ArtifactWriter): void {
    emit.json('.codex-plugin/plugin.json', this.#plugin)
    emit.json('.mcp.json', this.#mcp)
    emit.json('hooks/hooks.json', this.#hooks)
  }
}
