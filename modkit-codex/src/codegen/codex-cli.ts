import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { errorMessage, type Env } from '@atuin/modkit-target'

import type { PluginSelector } from './plugin-selector.ts'

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

/** The `codex` command, run in `env`, for what it changes in the user's Codex config. */
export class CodexCli {
  readonly #env: Env

  constructor(env: Env) {
    this.#env = env
  }

  /** List the marketplace in the directory `dir`, under the name its manifest gives. */
  async addMarketplace(dir: string): Promise<void> {
    await this.#run(['plugin', 'marketplace', 'add', dir])
  }

  /** Take the marketplace `name` out of Codex's config. */
  async removeMarketplace(name: string): Promise<void> {
    await this.#run(['plugin', 'marketplace', 'remove', name])
  }

  /** Install `selector`, which also copies a changed build over the one in Codex's cache. */
  async addPlugin(selector: PluginSelector): Promise<void> {
    await this.#run(['plugin', 'add', selector.toString()])
  }

  /** Uninstall `selector`. */
  async removePlugin(selector: PluginSelector): Promise<void> {
    await this.#run(['plugin', 'remove', selector.toString()])
  }

  async #run(args: readonly string[]): Promise<void> {
    await execFileAsync('codex', args, { encoding: 'utf8', env: this.#env }).catch(
      (error: unknown) => {
        throw new Error(`codex ${args.join(' ')} failed: ${errorMessage(error)}`, { cause: error })
      },
    )
  }
}
