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

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'rolldown'

import { defineTarget, NATIVE, type ModkitTarget } from '@atuin/modkit-target'

import { envSource } from './env.ts'
import { manifestOf } from './manifest.ts'
import { entrySource, StateModule } from './state.ts'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))
const ENTRY = '\0modkit-claude-entry'
const STATE = 'modkit-claude:state'
const ENV = 'modkit-claude:env'

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

/** The Claude Code target, which the CLI loads for a mod that lists `claude-code`. */
export const target: ModkitTarget<undefined> = defineTarget({
  name: 'claude-code',
  capabilities: {
    status: NATIVE,
    commands: NATIVE,
    panes: NATIVE,
    beforeShell: NATIVE,
    afterShell: NATIVE,
    beforeTool: NATIVE,
    afterTool: NATIVE,
    toolCards: NATIVE,
  },
  build: ({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, env, tools } = compiled
    const stateModule = new StateModule({ plugin, state })
    emit.write(async (dest) =>
      bundle({
        dir,
        out: dest,
        modules: new Map([
          [ENTRY, entrySource({ mod: entry, runtime: RUNTIME, tools })],
          [STATE, stateModule.source()],
          [ENV, envSource(env)],
        ]),
      }),
    )
    emit.json('.claude-plugin/plugin.json', manifestOf({ plugin, mod, options }))
    emit.json('hooks/hooks.json', { modules: ['./register.js'] })
    emit.text('types/index.d.ts', stateModule.contract())
    return { notes: [`load it with claude --plugin-dir ${out}`] }
  },
})
