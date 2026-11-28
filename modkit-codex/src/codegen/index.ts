import { Target, type ModkitTarget } from '@atuin/modkit-target'
import { emitRuntimeEntry, settingDecl, stateTags } from '@atuin/modkit-target-node/codegen'

import { CODEX_CAPABILITIES, CODEX_TOOLS } from '../protocol.ts'
import type { serve } from '../runtime/index.ts'
import { CodexPluginManifest } from './manifest.ts'

const RUNTIME_URL = new URL('../runtime/index.ts', import.meta.url)

export const target: ModkitTarget<undefined> = Target.define('codex')
  .capabilities(CODEX_CAPABILITIES)
  .knownTools(CODEX_TOOLS)
  .build(({ compiled, dir, plugin, emit }) => {
    const { mod, entry, state, options, env, images, hooks } = compiled
    const { hasStatus } = hooks
    const pluginName = plugin.toString()
    emitRuntimeEntry<typeof serve>(emit, {
      file: 'server.mjs',
      dir,
      runtimeUrl: RUNTIME_URL,
      exportName: 'serve',
      mode: 'top-level-await',
      mod: entry,
      images,
      payload: {
        plugin: pluginName,
        version: mod.version,
        settings: options.map((option) => settingDecl(option)),
        state: stateTags(state),
        hasStatus,
      },
    })
    CodexPluginManifest.build({ plugin, mod, env, hooks }).emitTo(emit)
    return {
      notes: [
        `Codex runs ${pluginName}'s hooks once they're approved in /hooks`,
        ...(hasStatus
          ? [
              `${pluginName}'s statuses show in Codex's footer once Custom status line is on in /experimental and ${pluginName} is picked in /statusline`,
            ]
          : []),
      ],
    }
  })
