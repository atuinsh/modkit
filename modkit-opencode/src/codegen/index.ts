import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genExport, genImport, genObjectFromValues, genString } from 'knitwork'

import { imagesSource, NATIVE, Target, type ModkitTarget } from '@atuin/modkit-target'
import { bundle, settingDecl, stateTags } from '@atuin/modkit-target-node/codegen'

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

function emitTui({
  dir,
  pluginName,
  emit,
}: {
  dir: string
  pluginName: string
  emit: {
    write: (task: (out: string) => Promise<void>) => void
    copy: (path: string, from: string) => void
  }
}): void {
  const shared = source([
    genImport(CONTRACT, ['contractOf']),
    '',
    `export const PLUGIN = ${genString(pluginName)}`,
    'export const CONTRACT = contractOf(PLUGIN)',
  ])
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
}

export const target: ModkitTarget<undefined> = Target.define('opencode')
  .capabilities({
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
  })
  .knownTools('opencode', OPENCODE_TOOLS)
  .build(({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, images } = compiled
    const pluginName = plugin.toString()
    const served = {
      plugin: pluginName,
      settings: options.map((option) => settingDecl(option)),
      state: stateTags(state),
    }
    const server = source([
      genImport(SERVER, ['createOpencodeServer']),
      genImport(entry, 'mod'),
      '',
      `export default createOpencodeServer({ mod, images: ${imagesSource(images)}, ...${genObjectFromValues(served)} })`,
    ])
    emit.write(async (dest) =>
      bundle({ dir, entry: server, file: join(dest, 'server.js'), external: PROVIDED }),
    )
    emitTui({ dir, pluginName, emit })
    emit.json('package.json', {
      name: pluginName,
      version: mod.version,
      description: mod.description,
      type: 'module',
      ...(mod.author !== undefined && { author: mod.author.name }),
      exports: { '.': './server.js', './tui': './tui.tsx', './rpc': './mod.js' },
    })
    return {
      notes: [
        `opencode loads ${pluginName} once ${out} is in the plugins of opencode.json`,
        ...(options.length > 0
          ? [
              `${pluginName}'s settings go in its entry's options: { "package": "${out}", "options": { ... } }`,
            ]
          : []),
      ],
    }
  })
