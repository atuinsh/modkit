import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genExport, genImport, genObjectFromValues, genString } from 'knitwork'

import { defineTarget, NATIVE, type ModInfo, type ModkitTarget } from '@atuin/modkit-target'
import { bundle, settingOf, tagsOf } from '@atuin/modkit-target-node/codegen'

const SERVER = fileURLToPath(new URL('../server/index.ts', import.meta.url))
const CONTRACT = fileURLToPath(new URL('../contract.ts', import.meta.url))
const DRAW = fileURLToPath(new URL('../tui/draw.ts', import.meta.url))
const TUI = fileURLToPath(new URL('../tui/index.tsx', import.meta.url))

const PROVIDED = [/^@opencode\//u, /^@opentui\//u, /^effect(?:\/|$)/u, /^solid-js(?:\/|$)/u]

const OPENCODE_TOOLS: ReadonlySet<string> = new Set([
  'Bash',
  'edit',
  'execute',
  'glob',
  'grep',
  'question',
  'read',
  'skill',
  'subagent',
  'webfetch',
  'websearch',
  'write',
])

const source = (lines: readonly string[]): string => [...lines, ''].join('\n')

const packageJsonOf = ({ plugin, mod }: { plugin: string; mod: ModInfo }): unknown => ({
  name: plugin,
  version: mod.version,
  description: mod.description,
  type: 'module',
  ...(mod.author !== undefined && { author: mod.author.name }),
  exports: { '.': './server.js', './tui': './tui.tsx', './rpc': './mod.js' },
})

const notesOf = ({
  out,
  plugin,
  hasSettings,
}: {
  out: string
  plugin: string
  hasSettings: boolean
}): string[] => [
  `opencode loads ${plugin} once ${out} is in the plugins of opencode.json`,
  ...(hasSettings
    ? [
        `${plugin}'s settings go in its entry's options: { "package": "${out}", "options": { ... } }`,
      ]
    : []),
]

export const target: ModkitTarget<undefined> = defineTarget({
  name: 'opencode',
  capabilities: {
    status: {
      kind: 'lowered',
      why: "opencode's footer draws a button as text, which can't be pressed",
    },
    commands: NATIVE,
    panes: {
      kind: 'lowered',
      why: 'opencode shows one pane at a time, the newest, and presses a button only by its hotkey',
    },
    beforeShell: NATIVE,
    afterShell: NATIVE,
    beforeTool: NATIVE,
    afterTool: NATIVE,
    toolCards: { kind: 'dropped', why: "opencode draws nothing under a tool's row" },
  },
  tools: { harness: 'opencode', has: OPENCODE_TOOLS },
  build: ({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options } = compiled
    const served = {
      plugin,
      settings: options.map((option) => settingOf(option)),
      state: tagsOf(state),
    }
    const server = source([
      genImport(SERVER, ['serverOf']),
      genImport(entry, 'mod'),
      '',
      `export default serverOf({ mod, ...${genObjectFromValues(served)} })`,
    ])
    const shared = source([
      genImport(CONTRACT, ['contractOf']),
      '',
      `export const PLUGIN = ${genString(plugin)}`,
      'export const CONTRACT = contractOf(PLUGIN)',
    ])
    emit.write(async (dest) =>
      bundle({ dir, entry: server, file: join(dest, 'server.js'), external: PROVIDED }),
    )
    emit.write(async (dest) =>
      bundle({ dir, entry: shared, file: join(dest, 'mod.js'), platform: 'neutral' }),
    )
    emit.write(async (dest) =>
      bundle({
        dir,
        entry: source([genExport(DRAW, '*')]),
        file: join(dest, 'draw.js'),
        platform: 'neutral',
      }),
    )
    emit.copy('tui.tsx', TUI)
    emit.json('package.json', packageJsonOf({ plugin, mod }))
    return { notes: notesOf({ out, plugin, hasSettings: options.length > 0 }) }
  },
})
