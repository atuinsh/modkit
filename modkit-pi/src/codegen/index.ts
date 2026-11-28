import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'

import { imagesSource, NATIVE, Target, type ModkitTarget } from '@atuin/modkit-target'
import { bundle, settingDecl, stateTags } from '@atuin/modkit-target-node/codegen'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))

const PROVIDED = /^@(?:earendil-works|mariozechner)\//u

const PI_TOOLS: ReadonlySet<string> = new Set([
  'Bash',
  'read',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
  'powershell',
])

export const target: ModkitTarget<undefined> = Target.define('pi')
  .capabilities({
    status: NATIVE,
    commands: NATIVE,
    panes: NATIVE,
    beforeShell: NATIVE,
    afterShell: NATIVE,
    beforeTool: NATIVE,
    afterTool: NATIVE,
    toolCards: {
      kind: 'lowered',
      why: "pi draws a card's buttons but can't press them, since its transcript rows take no keys",
    },
  })
  .knownTools('pi', PI_TOOLS)
  .build(({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, images, hooks } = compiled
    const pluginName = plugin.toString()
    const served = {
      plugin: pluginName,
      settings: options.map((option) => settingDecl(option)),
      state: stateTags(state),
      cards: hooks.cards,
      hasPanes: hooks.hasPanes,
    }
    const source = [
      genImport(RUNTIME, ['createPiExtension']),
      genImport(entry, 'mod'),
      '',
      `export default createPiExtension({ mod, images: ${imagesSource(images)}, ...${genObjectFromValues(served)} })`,
      '',
    ].join('\n')
    emit.write(async (dest) =>
      bundle({ dir, entry: source, file: join(dest, 'extension.js'), external: PROVIDED }),
    )
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
