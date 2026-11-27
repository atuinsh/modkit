/**
 * Claude Code plugin builder (`@atuin/modkit-claude-code/codegen`).
 *
 * Compiles a modkit mod and writes a Claude Code plugin directory suitable for
 * `claude --plugin-dir <out>` and `claude plugin validate`:
 *
 * ```text
 * <out>/.claude-plugin/plugin.json   plugin metadata, userConfig settings, and types path
 * <out>/hooks/hooks.json             hook module manifest pointing to ./register.js
 * <out>/hooks/register.js            bundled mod, generated state/env modules, and runtime adapter
 * <out>/types/index.d.ts             PluginState module augmentation for claude plugin validate
 * ```
 *
 * @module
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'rolldown'
import * as v from 'valibot'

import {
  ModkitTarget,
  NATIVE,
  pluginNameOf,
  type BuildInput,
  type Built,
  type Capabilities,
} from '@atuin/modkit-target'

import { envSource } from './env.ts'
import { manifestOf } from './manifest.ts'
import { entrySource, StateModule } from './state.ts'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))
const ENTRY = '\0modkit-claude-entry'
const STATE = 'modkit-claude:state'
const ENV = 'modkit-claude:env'

const JSON_INDENT_SPACES = 2

const json = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`

async function bundle({
  dir,
  out,
  modules,
}: {
  dir: string
  out: string
  modules: ReadonlyMap<string, string>
}): Promise<void> {
  await build({
    input: ENTRY,
    cwd: dir,
    platform: 'neutral',
    external: ['claude-code'],
    plugins: [
      {
        name: 'modkit-claude-entry',
        resolveId: (id) => (modules.has(id) ? id : null),
        load: (id) => modules.get(id) ?? null,
      },
    ],
    transform: { jsx: { runtime: 'automatic', importSource: '@atuin/modkit' } },
    // A mod's JSX is modkit's whatever its tsconfig says, so the override Rolldown warns of is meant.
    // oxlint-disable-next-line eslint/max-params -- Rolldown's signature
    onLog: (level, log, handler) => {
      if (log.code === 'CONFIGURATION_FIELD_CONFLICT' && log.message.includes('jsxImportSource')) {
        return
      }
      handler(level, log)
    },
    write: true,
    output: { file: join(out, 'hooks', 'register.js'), format: 'es', codeSplitting: false },
  })
}

// Claude Code takes no options of a mod yet, so its section holds only the gaps it accepts.
const OptionsSchema: v.GenericSchema<unknown, undefined> = v.pipe(
  v.strictObject({}),
  v.transform(() => undefined),
)

/** Claude Code, which runs a mod as a plugin of `plugin.json`, `hooks.json`, `register.js` and types. */
class ClaudeCodeTarget extends ModkitTarget<undefined> {
  override readonly name = 'claude-code'
  override readonly capabilities: Capabilities = {
    status: NATIVE,
    commands: NATIVE,
    panes: NATIVE,
    beforeShell: NATIVE,
    afterShell: NATIVE,
    beforeTool: NATIVE,
    afterTool: NATIVE,
    toolCards: NATIVE,
  }
  override readonly options: v.GenericSchema<unknown, undefined> = OptionsSchema

  override async build({ compiled, dir, out }: BuildInput<undefined>): Promise<Built> {
    const { mod, entry, state, options, env, tools, images } = compiled
    const plugin = pluginNameOf(mod.name)
    await bundle({
      dir,
      out,
      modules: new Map([
        [ENTRY, entrySource({ mod: entry, runtime: RUNTIME, tools, images })],
        [STATE, new StateModule({ plugin, state }).source()],
        [ENV, envSource(env)],
      ]),
    })
    await mkdir(join(out, '.claude-plugin'), { recursive: true })
    await mkdir(join(out, 'types'), { recursive: true })
    const manifest = manifestOf({ plugin, mod, options })
    await writeFile(join(out, '.claude-plugin', 'plugin.json'), json(manifest))
    await writeFile(join(out, 'hooks', 'hooks.json'), json({ modules: ['./register.js'] }))
    await writeFile(join(out, 'types', 'index.d.ts'), new StateModule({ plugin, state }).contract())
    return { isOk: true, plugin, notes: [`load it with claude --plugin-dir ${out}`] }
  }
}

/** The Claude Code target, which the CLI loads for a mod that lists `claude-code`. */
export const target: ModkitTarget<undefined> = new ClaudeCodeTarget()
