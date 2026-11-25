import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'
import * as v from 'valibot'

import {
  ModkitTarget,
  NATIVE,
  pluginNameOf,
  type BuildInput,
  type Built,
  type Capabilities,
} from '@atuin/modkit-target'
import { bundle, missingToolNotes, settingOf } from '@atuin/modkit-target-node/codegen'
import type { SettingDecl } from '@atuin/modkit-target-node/runtime/settings'

import { hooksJsonOf } from './hooks.ts'
import { mcpJsonOf, pluginJsonOf } from './manifest.ts'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))

const JSON_INDENT_SPACES = 2

const json = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`

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

// Codex takes no options of a mod yet, so its section holds only the gaps it accepts.
const OptionsSchema: v.GenericSchema<unknown, undefined> = v.pipe(
  v.strictObject({}),
  v.transform(() => undefined),
)

class CodexTarget extends ModkitTarget<undefined> {
  override readonly name = 'codex'
  override readonly capabilities: Capabilities = {
    status: NATIVE,
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
  }
  override readonly options: v.GenericSchema<unknown, undefined> = OptionsSchema

  override async build({ compiled, dir, out }: BuildInput<undefined>): Promise<Built> {
    const { mod, entry, options, env, tools, modparts } = compiled
    const plugin = pluginNameOf(mod.name)
    const hasStatus = modparts.status !== undefined
    const served = {
      plugin,
      version: mod.version,
      settings: options.map((option) => settingOf(option)),
      hasStatus,
    }
    await bundle({ dir, entry: entrySource({ mod: entry, served }), file: join(out, 'server.mjs') })
    await mkdir(join(out, '.codex-plugin'), { recursive: true })
    await mkdir(join(out, 'hooks'), { recursive: true })
    await writeFile(join(out, '.codex-plugin', 'plugin.json'), json(pluginJsonOf({ plugin, mod })))
    await writeFile(join(out, '.mcp.json'), json(mcpJsonOf({ plugin, env })))
    const hooks = hooksJsonOf({ plugin, hasBeforeShell: modparts.beforeShell !== undefined, tools })
    await writeFile(join(out, 'hooks', 'hooks.json'), json(hooks))
    return {
      isOk: true,
      plugin,
      notes: [
        ...notesOf({ plugin, hasStatus }),
        ...missingToolNotes({ tools, harness: 'Codex', has: CODEX_TOOLS }),
      ],
    }
  }
}

export const target: ModkitTarget<undefined> = new CodexTarget()
