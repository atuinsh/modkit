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
  type ModInfo,
} from '@atuin/modkit-target'
import { bundle, missingToolNotes, settingOf, tagsOf } from '@atuin/modkit-target-node/codegen'

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

const JSON_INDENT_SPACES = 2

const json = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`

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

// No option of a mod's is pi's yet, so its section holds only the gaps it accepts.
const OptionsSchema: v.GenericSchema<unknown, undefined> = v.pipe(
  v.strictObject({}),
  v.transform(() => undefined),
)

class PiTarget extends ModkitTarget<undefined> {
  override readonly name = 'pi'
  override readonly capabilities: Capabilities = {
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
  }
  override readonly options: v.GenericSchema<unknown, undefined> = OptionsSchema

  override async build({ compiled, dir, out }: BuildInput<undefined>): Promise<Built> {
    const { mod, entry, state, options, tools, modparts } = compiled
    const plugin = pluginNameOf(mod.name)
    const served = {
      plugin,
      settings: options.map((option) => settingOf(option)),
      state: tagsOf(state),
      cards: tools.cards,
      // A command can hold a pane of its own, so a mod with either has panes to move to.
      hasPanes: modparts.panes !== undefined || modparts.commands !== undefined,
    }
    const source = [
      genImport(RUNTIME, ['extensionOf']),
      genImport(entry, 'mod'),
      '',
      `export default extensionOf({ mod, ...${genObjectFromValues(served)} })`,
      '',
    ].join('\n')
    await mkdir(out, { recursive: true })
    await bundle({ dir, entry: source, file: join(out, 'extension.js'), external: PROVIDED })
    await writeFile(join(out, 'package.json'), json(packageJsonOf({ plugin, mod })))
    return {
      isOk: true,
      plugin,
      notes: [
        ...notesOf({ out, plugin, hasSettings: options.length > 0 }),
        ...missingToolNotes({ tools, harness: 'pi', has: PI_TOOLS }),
      ],
    }
  }
}

export const target: ModkitTarget<undefined> = new PiTarget()
