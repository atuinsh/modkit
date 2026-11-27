import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'

import { defineTarget, NATIVE, type ModkitTarget } from '@atuin/modkit-target'
import { bundle, settingOf, tagsOf } from '@atuin/modkit-target-node/codegen'
import type { SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import type { Tags } from '@atuin/modkit-target-node/runtime/store'

import { manifestsOf } from './manifest.ts'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))

const CODEX_TOOLS: ReadonlySet<string> = new Set([
  'Bash',
  'apply_patch',
  'spawn_agent',
  'write_stdin',
  'request_permissions',
])

function notesOf({ plugin, hasStatus }: { plugin: string; hasStatus: boolean }): string[] {
  return [
    `Codex runs ${plugin}'s hooks once they're approved in /hooks`,
    ...(hasStatus
      ? [
          `${plugin}'s statuses show in Codex's footer once Custom status line is on in /experimental and ${plugin} is picked in /statusline`,
        ]
      : []),
  ]
}

const entrySource = ({
  mod,
  served,
}: {
  mod: string
  served: {
    plugin: string
    version: string
    settings: readonly SettingDecl[]
    state: Tags
    hasStatus: boolean
  }
}): string =>
  [
    genImport(RUNTIME, ['serve']),
    genImport(mod, 'mod'),
    '',
    `await serve({ mod, ...${genObjectFromValues(served)} })`,
    '',
  ].join('\n')

export const target: ModkitTarget<undefined> = defineTarget({
  name: 'codex',
  capabilities: {
    status: {
      kind: 'lowered',
      why: "Codex's status line draws a button as text, which can't be pressed",
    },
    commands: {
      kind: 'dropped',
      why: "Codex answers a slash command with a prompt, never with a mod's code",
    },
    panes: { kind: 'dropped', why: 'Codex draws no panes' },
    beforeShell: NATIVE,
    afterShell: NATIVE,
    beforeTool: NATIVE,
    afterTool: NATIVE,
    toolCards: { kind: 'dropped', why: 'Codex draws nothing under a tool call' },
  },
  tools: { harness: 'Codex', has: CODEX_TOOLS },
  build: ({ compiled, dir, plugin, emit }) => {
    const { mod, entry, state, options, env, hooks } = compiled
    const { hasStatus } = hooks
    const served = {
      plugin,
      version: mod.version,
      settings: options.map((option) => settingOf(option)),
      state: tagsOf(state),
      hasStatus,
    }
    const manifests = manifestsOf({ plugin, mod, env, hooks })
    emit.write(async (out) =>
      bundle({ dir, entry: entrySource({ mod: entry, served }), file: join(out, 'server.mjs') }),
    )
    emit.json('.codex-plugin/plugin.json', manifests.plugin)
    emit.json('.mcp.json', manifests.mcp)
    emit.json('hooks/hooks.json', manifests.hooks)
    return { notes: notesOf({ plugin, hasStatus }) }
  },
})
