import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { escapeRegExp } from 'es-toolkit/string'

import {
  errorMessage,
  PluginName,
  type DevCommand,
  type DevHarness,
  type DevInput,
  type Env,
} from '@atuin/modkit-target'

import { STATUSLINE_TOOL } from '../protocol.ts'

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

const JSON_INDENT_SPACES = 2

const json = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`

async function codex({ args, env }: { args: readonly string[]; env: Env }): Promise<void> {
  await execFileAsync('codex', args, { encoding: 'utf8', env }).catch((error: unknown) => {
    throw new Error(`codex ${args.join(' ')} failed: ${errorMessage(error)}`, { cause: error })
  })
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

// The selectors of the copies of `plugin` that Codex's config installs, `atuin@atuin-local`: one
// table header each, `[plugins."atuin@atuin-local"]`.
function installedCopies({ plugin, env }: { plugin: string; env: Env }): string[] {
  const path = join(env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'config.toml')
  const text = (() => {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if (isMissing(error)) return ''
      throw error
    }
  })()
  const header = new RegExp(String.raw`^\[plugins\."(${escapeRegExp(plugin)}@[^"]+)"\]`, 'gmu')
  return [...text.matchAll(header)].flatMap(([, selector]) => selector ?? [])
}

/**
 * Codex on a build. Codex loads a plugin only once it is installed from a marketplace, which
 * copies it into Codex's cache, so each build is copied into a marketplace of its own in
 * `scratch` and installed from there, and both are taken out of Codex's config on close.
 */
class CodexDev implements DevHarness {
  readonly reload = 'restarted'
  readonly #out: string
  readonly #plugin: string
  readonly #hasStatus: boolean
  readonly #scratch: string
  readonly #env: Env
  #isListed = false

  constructor({ out, plugin, hasStatus, scratch, env }: DevInput) {
    this.#out = out
    this.#plugin = plugin
    this.#hasStatus = hasStatus
    this.#scratch = scratch
    this.#env = env
  }

  // Puts the mod's status in this session's footer over the status line the user picked, which
  // `/statusline` keeps for every session. `-c` reads its value as TOML, here an inline table.
  get #statusLine(): string[] {
    if (!this.#hasStatus) return []
    const server = JSON.stringify(PluginName.parse(this.#plugin).serverName())
    const provider = `{ server = ${server}, tool = ${JSON.stringify(STATUSLINE_TOOL)} }`
    return [
      '-c',
      'features.tui_extensions_statusline=true',
      '-c',
      `tui.status_line_provider=${provider}`,
    ]
  }

  get #marketplace(): string {
    return `modkit-dev-${this.#plugin}`
  }

  get #selector(): string {
    return `${this.#plugin}@${this.#marketplace}`
  }

  command(): DevCommand {
    // A second copy of the plugin would serve its MCP server under the same name, so the session
    // turns the others off. Codex splits a `-c` key at each `.` and keeps quotes as part of a key,
    // so the selector goes in bare.
    const others = installedCopies({ plugin: this.#plugin, env: this.#env }).filter(
      (selector) => selector !== this.#selector,
    )
    const disabled = others.flatMap((selector) => ['-c', `plugins.${selector}.enabled=false`])
    return { program: 'codex', args: [...disabled, ...this.#statusLine], env: {} }
  }

  async built(): Promise<void> {
    const copy = join(this.#scratch, this.#plugin)
    await rm(copy, { recursive: true, force: true })
    await cp(this.#out, copy, { recursive: true })
    const manifest = {
      name: this.#marketplace,
      description: `${this.#plugin} as modkit dev last built it`,
      owner: { name: 'modkit dev' },
      plugins: [{ name: this.#plugin, source: `./${this.#plugin}` }],
    }
    await mkdir(join(this.#scratch, '.claude-plugin'), { recursive: true })
    await writeFile(join(this.#scratch, '.claude-plugin', 'marketplace.json'), json(manifest))
    if (!this.#isListed) {
      await codex({ args: ['plugin', 'marketplace', 'add', this.#scratch], env: this.#env })
      this.#isListed = true
    }
    // Also what copies a changed build over the one in Codex's cache.
    await codex({ args: ['plugin', 'add', this.#selector], env: this.#env })
  }

  async close(): Promise<void> {
    if (!this.#isListed) return
    const env = this.#env
    try {
      await codex({ args: ['plugin', 'remove', this.#selector], env })
    } finally {
      await codex({ args: ['plugin', 'marketplace', 'remove', this.#marketplace], env })
      await rm(this.#scratch, { recursive: true, force: true })
    }
  }
}

export const codexDev = (input: DevInput): DevHarness => new CodexDev(input)
