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

import { Target, type ModkitTarget, type VirtualModule } from '@atuin/modkit-target'

import { CLAUDE_CODE_CAPABILITIES } from '../spec.ts'
import { StateContract } from './contract.ts'
import { ClaudeEntryModule } from './entry.ts'
import { ClaudeEnvModule } from './env.ts'
import { ClaudeManifest } from './manifest.ts'
import { StateModule } from './state.ts'

const RUNTIME = fileURLToPath(new URL('../runtime/index.ts', import.meta.url))

async function bundle({
  dir,
  out,
  entry,
  modules,
}: {
  dir: string
  out: string
  entry: VirtualModule
  modules: readonly VirtualModule[]
}): Promise<void> {
  const byId = new Map(modules.map((mod) => [mod.id, mod]))
  await build({
    input: entry.id,
    cwd: dir,
    platform: 'neutral',
    external: ['claude-code'],
    plugins: [
      {
        name: 'modkit-claude-entry',
        resolveId: (id) => (byId.has(id) ? id : null),
        load: (id) => byId.get(id)?.emitSource() ?? null,
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
export const target: ModkitTarget<undefined> = Target.define('claude-code')
  .capabilities(CLAUDE_CODE_CAPABILITIES)
  .build(({ compiled, dir, out, plugin, emit }) => {
    const { mod, entry, state, options, env, tools, images } = compiled
    const pluginName = plugin.toString()
    const entryModule = new ClaudeEntryModule({ mod: entry, runtime: RUNTIME, tools, images })
    const modules: readonly VirtualModule[] = [
      entryModule,
      new StateModule({ plugin: pluginName, state }),
      new ClaudeEnvModule(env),
    ]
    emit.write(async (dest) => bundle({ dir, out: dest, entry: entryModule, modules }))
    new ClaudeManifest({ plugin: pluginName, mod, options }).emitTo(emit)
    new StateContract({ plugin: pluginName, state }).emitTo(emit)
    return { notes: [`load it with claude --plugin-dir ${out}`] }
  })
