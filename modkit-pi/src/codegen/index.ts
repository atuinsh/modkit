import { Target, type ModkitTarget } from '@atuin/modkit-target'
import { NodeBundler } from '@atuin/modkit-target-node/codegen'

import type { createPiExtension } from '../runtime/index.ts'
import { PI_CAPABILITIES, PI_TOOLS } from '../spec.ts'

const RUNTIME_URL = new URL('../runtime/index.ts', import.meta.url)

const PROVIDED = /^@(?:earendil-works|mariozechner)\//u

export const target: ModkitTarget<undefined> = Target.define('pi')
  .capabilities(PI_CAPABILITIES)
  .knownTools(PI_TOOLS)
  .build(({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, images, hooks } = compiled
    const pluginName = plugin.toString()
    NodeBundler.for({ dir, emit }).emitEntry<typeof createPiExtension>({
      file: 'extension.js',
      runtimeUrl: RUNTIME_URL,
      exportName: 'createPiExtension',
      mode: 'default-export',
      mod: entry,
      images,
      external: PROVIDED,
      payload: {
        plugin: pluginName,
        settings: options.map((option) => NodeBundler.settingDecl(option)),
        state: NodeBundler.stateTags(state),
        cards: hooks.cards,
        hasPanes: hooks.hasPanes,
      },
    })
    emit.json('package.json', {
      name: pluginName,
      version: mod.version,
      description: mod.description,
      type: 'module',
      keywords: ['pi-package'],
      ...(mod.author !== undefined && { author: mod.author.name }),
      pi: { extensions: ['./extension.js'] },
    })
    return {
      notes: [
        `pi loads ${pluginName} once it's installed with: pi install ${out}`,
        ...(options.length > 0
          ? [`${pluginName}'s settings go in ~/.pi/agent/modkit/${pluginName}/settings.json`]
          : []),
      ],
    }
  })
