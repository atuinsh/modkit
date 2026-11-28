import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'

import {
  imagesSource,
  NATIVE,
  Target,
  type ImageDecl,
  type ModkitTarget,
} from '@atuin/modkit-target'
import { bundle, settingDecl, stateTags } from '@atuin/modkit-target-node/codegen'
import type { SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import type { Tags } from '@atuin/modkit-target-node/runtime/store'

import { CodexPluginManifest } from './manifest.ts'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))

const CODEX_TOOLS: ReadonlySet<string> = new Set([
  'Bash',
  'apply_patch',
  'spawn_agent',
  'write_stdin',
  'request_permissions',
])

const entrySource = ({
  mod,
  images,
  served,
}: {
  mod: string
  images: readonly ImageDecl[]
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
    `await serve({ mod, images: ${imagesSource(images)}, ...${genObjectFromValues(served)} })`,
    '',
  ].join('\n')

export const target: ModkitTarget<undefined> = Target.define('codex')
  .capabilities({
    status: {
      kind: 'lowered',
      why: "Codex's status line draws buttons and links as text, which can't be pressed or opened",
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
  })
  .knownTools('Codex', CODEX_TOOLS)
  .build(({ compiled, dir, plugin, emit }) => {
    const { mod, entry, state, options, env, images, hooks } = compiled
    const { hasStatus } = hooks
    const pluginName = plugin.toString()
    const served = {
      plugin: pluginName,
      version: mod.version,
      settings: options.map((option) => settingDecl(option)),
      state: stateTags(state),
      hasStatus,
    }
    const source = entrySource({ mod: entry, images, served })
    emit.write(async (out) => bundle({ dir, entry: source, file: join(out, 'server.mjs') }))
    CodexPluginManifest.build({ plugin, mod, env, hooks }).emitTo(emit)
    return {
      notes: [
        `Codex runs ${pluginName}'s hooks once they're approved in /hooks`,
        ...(hasStatus
          ? [
              `${pluginName}'s statuses show in Codex's footer once Custom status line is on in /experimental and ${pluginName} is picked in /statusline`,
            ]
          : []),
      ],
    }
  })
