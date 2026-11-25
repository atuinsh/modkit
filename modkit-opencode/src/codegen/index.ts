import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genExport, genImport, genObjectFromValues, genString } from 'knitwork'
import * as v from 'valibot'

import {
  ModkitTarget,
  NATIVE,
  pluginNameOf,
  type BuildInput,
  type Built,
  type Capabilities,
  type ModInfo,
} from '@atuin/modkit-target'
import { bundle, missingToolNotes, settingOf } from '@atuin/modkit-target-node/codegen'

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

const JSON_INDENT_SPACES = 2

const json = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
const source = (lines: readonly string[]): string => [...lines, ''].join('\n')

const packageJsonOf = ({ plugin, mod }: { plugin: string; mod: ModInfo }): unknown => ({
  name: plugin,
  version: mod.version,
  description: mod.description,
  type: 'module',
  ...(mod.author !== undefined && { author: mod.author.name }),
  exports: { '.': './server.js', './tui': './tui.tsx', './rpc': './mod.js' },
})

async function writeTui({
  dir,
  out,
  plugin,
}: {
  dir: string
  out: string
  plugin: string
}): Promise<void> {
  const shared = source([
    genImport(CONTRACT, ['contractOf']),
    '',
    `export const PLUGIN = ${genString(plugin)}`,
    'export const CONTRACT = contractOf(PLUGIN)',
  ])
  await bundle({ dir, entry: shared, file: join(out, 'mod.js'), platform: 'neutral' })
  const draw = source([genExport(DRAW, '*')])
  await bundle({ dir, entry: draw, file: join(out, 'draw.js'), platform: 'neutral' })
  await copyFile(TUI, join(out, 'tui.tsx'))
}

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

// No options of a mod's yet for opencode, so its section holds only the gaps it accepts.
const OptionsSchema: v.GenericSchema<unknown, undefined> = v.pipe(
  v.strictObject({}),
  v.transform(() => undefined),
)

class OpencodeTarget extends ModkitTarget<undefined> {
  override readonly name = 'opencode'
  override readonly capabilities: Capabilities = {
    status: NATIVE,
    commands: NATIVE,
    panes: { kind: 'lowered', why: 'opencode shows one pane at a time, the newest' },
    beforeShell: NATIVE,
    afterShell: NATIVE,
    beforeTool: NATIVE,
    afterTool: NATIVE,
    toolCards: { kind: 'dropped', why: "opencode draws nothing under a tool's row" },
  }
  override readonly options: v.GenericSchema<unknown, undefined> = OptionsSchema

  override async build({ compiled, dir, out }: BuildInput<undefined>): Promise<Built> {
    const { mod, entry, options, tools } = compiled
    const plugin = pluginNameOf(mod.name)
    const served = { plugin, settings: options.map((option) => settingOf(option)) }
    await mkdir(out, { recursive: true })
    const server = source([
      genImport(SERVER, ['serverOf']),
      genImport(entry, 'mod'),
      '',
      `export default serverOf({ mod, ...${genObjectFromValues(served)} })`,
    ])
    await bundle({ dir, entry: server, file: join(out, 'server.js'), external: PROVIDED })
    await writeTui({ dir, out, plugin })
    await writeFile(join(out, 'package.json'), json(packageJsonOf({ plugin, mod })))
    return {
      isOk: true,
      plugin,
      notes: [
        ...notesOf({ out, plugin, hasSettings: options.length > 0 }),
        ...missingToolNotes({ tools, harness: 'opencode', has: OPENCODE_TOOLS }),
      ],
    }
  }
}

export const target: ModkitTarget<undefined> = new OpencodeTarget()
