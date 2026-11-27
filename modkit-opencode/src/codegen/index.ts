import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genExport, genImport, genString } from 'knitwork'

import { Target, type ArtifactWriter, type ModkitTarget } from '@atuin/modkit-target'
import { bundle, emitRuntimeEntry, settingDecl, stateTags } from '@atuin/modkit-target-node/codegen'

import { OPENCODE_CAPABILITIES, OPENCODE_TOOLS } from '../contract.ts'
import type { createOpencodeServer } from '../server/index.ts'

const SERVER_URL = new URL('../server/index.ts', import.meta.url)
const CONTRACT = fileURLToPath(new URL('../contract.ts', import.meta.url))
const DRAW = fileURLToPath(new URL('../tui/draw.ts', import.meta.url))
const TUI = fileURLToPath(new URL('../tui/index.tsx', import.meta.url))

const PROVIDED = [/^@opencode\//u, /^@opentui\//u, /^effect(?:\/|$)/u, /^solid-js(?:\/|$)/u]

const source = (lines: readonly string[]): string => [...lines, ''].join('\n')

function emitTui({
  dir,
  pluginName,
  emit,
}: {
  dir: string
  pluginName: string
  emit: Pick<ArtifactWriter, 'write' | 'copy'>
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
  .capabilities(OPENCODE_CAPABILITIES)
  .knownTools(OPENCODE_TOOLS)
  .dev(({ out }) => ({
    reload: 'restarted',
    command: ({ id }) => ({
      program: 'opencode',
      // A private server reads the config in this environment; the shared background one
      // already read its own.
      args: ['--standalone', '--session', `ses_${id.replaceAll('-', '')}`],
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugins: [out] }) },
    }),
  }))
  .build(({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, images } = compiled
    const pluginName = plugin.toString()
    emitRuntimeEntry<typeof createOpencodeServer>(emit, {
      file: 'server.js',
      dir,
      runtimeUrl: SERVER_URL,
      exportName: 'createOpencodeServer',
      mode: 'default-export',
      mod: entry,
      images,
      external: PROVIDED,
      payload: {
        plugin: pluginName,
        settings: options.map((option) => settingDecl(option)),
        state: stateTags(state),
      },
    })
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
