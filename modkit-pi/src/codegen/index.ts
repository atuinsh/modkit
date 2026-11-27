import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'

import { defineTarget, NATIVE, type ModInfo, type ModkitTarget } from '@atuin/modkit-target'
import { bundle, settingOf, tagsOf } from '@atuin/modkit-target-node/codegen'

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

const packageJsonOf = ({ plugin, mod }: { plugin: string; mod: ModInfo }): unknown => ({
  name: plugin,
  version: mod.version,
  description: mod.description,
  type: 'module',
  keywords: ['pi-package'],
  ...(mod.author !== undefined && { author: mod.author.name }),
  pi: { extensions: ['./extension.js'] },
})

function notesOf({
  out,
  plugin,
  hasSettings,
}: {
  out: string
  plugin: string
  hasSettings: boolean
}): string[] {
  return [
    `pi loads ${plugin} once it's installed with: pi install ${out}`,
    ...(hasSettings
      ? [`${plugin}'s settings go in ~/.pi/agent/modkit/${plugin}/settings.json`]
      : []),
  ]
}

export const target: ModkitTarget<undefined> = defineTarget({
  name: 'pi',
  capabilities: {
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
  },
  tools: { harness: 'pi', has: PI_TOOLS },
  build: ({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, hooks } = compiled
    const served = {
      plugin,
      settings: options.map((option) => settingOf(option)),
      state: tagsOf(state),
      cards: hooks.cards,
      hasPanes: hooks.hasPanes,
    }
    const source = [
      genImport(RUNTIME, ['extensionOf']),
      genImport(entry, 'mod'),
      '',
      `export default extensionOf({ mod, ...${genObjectFromValues(served)} })`,
      '',
    ].join('\n')
    emit.write(async (dest) =>
      bundle({ dir, entry: source, file: join(dest, 'extension.js'), external: PROVIDED }),
    )
    emit.json('package.json', packageJsonOf({ plugin, mod }))
    return { notes: notesOf({ out, plugin, hasSettings: options.length > 0 }) }
  },
})
