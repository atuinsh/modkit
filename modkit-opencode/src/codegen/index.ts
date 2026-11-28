import { fileURLToPath } from 'node:url'

import { genExport, genImport, genString } from 'knitwork'

import {
  Target,
  type ArtifactWriter,
  type ModkitTarget,
  type SourceEmitter,
} from '@atuin/modkit-target'
import { NodeBundler } from '@atuin/modkit-target-node/codegen'

import { OPENCODE_CAPABILITIES, OPENCODE_TOOLS } from '../contract.ts'
import type { createOpencodeServer } from '../server/index.ts'

const SERVER_URL = new URL('../server/index.ts', import.meta.url)
const CONTRACT = fileURLToPath(new URL('../contract.ts', import.meta.url))
const DRAW = fileURLToPath(new URL('../tui/draw.ts', import.meta.url))
const TUI = fileURLToPath(new URL('../tui/index.tsx', import.meta.url))

const PROVIDED = [/^@opencode\//u, /^@opentui\//u, /^effect(?:\/|$)/u, /^solid-js(?:\/|$)/u]

const linesEmitter = (lines: readonly string[]): SourceEmitter => ({
  emitSource: () => [...lines, ''].join('\n'),
})

function emitTui({
  bundler,
  pluginName,
  emit,
}: {
  bundler: NodeBundler
  pluginName: string
  emit: Pick<ArtifactWriter, 'copy'>
}): void {
  const shared = linesEmitter([
    genImport(CONTRACT, ['OpencodeContract']),
    '',
    `export const PLUGIN = ${genString(pluginName)}`,
    'export const CONTRACT = OpencodeContract.for(PLUGIN)',
  ])
  bundler.bundle({ entry: shared, file: 'mod.js', platform: 'neutral' })
  bundler.bundle({
    entry: linesEmitter([genExport(DRAW, '*')]),
    file: 'draw.js',
    platform: 'neutral',
  })
  emit.copy('tui.tsx', TUI)
}

export const target: ModkitTarget<undefined> = Target.define('opencode')
  .capabilities(OPENCODE_CAPABILITIES)
  .knownTools(OPENCODE_TOOLS)
  .build(({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, images } = compiled
    const pluginName = plugin.toString()
    const bundler = NodeBundler.for({ dir, emit })
    bundler.emitEntry<typeof createOpencodeServer>({
      file: 'server.js',
      runtimeUrl: SERVER_URL,
      exportName: 'createOpencodeServer',
      mode: 'default-export',
      mod: entry,
      images,
      external: PROVIDED,
      payload: {
        plugin: pluginName,
        settings: options.map((option) => NodeBundler.settingDecl(option)),
        state: NodeBundler.stateTags(state),
      },
    })
    emitTui({ bundler, pluginName, emit })
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
