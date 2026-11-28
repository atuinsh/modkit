import { createHash } from 'node:crypto'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  PluginName,
  type DevCommand,
  type DevHarness,
  type DevInput,
  type Env,
} from '@atuin/modkit-target'

import { STATUSLINE_TOOL } from '../protocol.ts'
import { CodexCli } from './codex-cli.ts'
import { CodexConfig } from './codex-config.ts'
import { PluginSelector } from './plugin-selector.ts'

const JSON_INDENT_SPACES = 2

/** How much of a workspace's hash its marketplace's name carries. */
const WORKSPACE_HASH_CHARS = 6

/**
 * Codex on a build. Codex loads a plugin only once it is installed from a marketplace, which
 * copies it into Codex's cache, so each build is copied into a marketplace of its own in
 * `scratch` and installed from there, and both are taken out of Codex's config on disposal.
 */
export class CodexDev implements DevHarness {
  readonly reload = 'restarted'
  readonly writes: readonly string[] = []
  readonly #out: string
  readonly #plugin: string
  readonly #hasStatus: boolean
  readonly #scratch: string
  readonly #env: Env
  readonly #codex: CodexCli
  #isListed = false

  constructor({ out, plugin, hasStatus, scratch, env }: DevInput) {
    this.#out = out
    this.#plugin = plugin
    this.#hasStatus = hasStatus
    this.#scratch = scratch
    this.#env = env
    this.#codex = new CodexCli(env)
  }

  readonly command = (): DevCommand => {
    // A second copy of the plugin would serve its MCP server under the same name, so the session
    // turns the others off. Codex splits a `-c` key at each `.` and keeps quotes as part of a key,
    // so the selector goes in bare.
    const others = CodexConfig.read(this.#env)
      .installed(this.#plugin)
      .filter((selector) => !selector.equals(this.#selector))
    const disabled = others.flatMap((selector) => [
      '-c',
      `plugins.${selector.toString()}.enabled=false`,
    ])
    return { program: 'codex', args: [...disabled, ...this.#statusLine], env: {} }
  }

  readonly built = async (): Promise<void> => {
    const copy = join(this.#scratch, this.#plugin)
    await rm(copy, { recursive: true, force: true })
    await cp(this.#out, copy, { recursive: true })
    const manifest = {
      name: this.#marketplace,
      description: `${this.#plugin} as modkit dev last built it`,
      owner: { name: 'modkit dev' },
      plugins: [{ name: this.#plugin, source: `./${this.#plugin}` }],
    }
    const text = `${JSON.stringify(manifest, null, JSON_INDENT_SPACES)}\n`
    await mkdir(join(this.#scratch, '.claude-plugin'), { recursive: true })
    await writeFile(join(this.#scratch, '.claude-plugin', 'marketplace.json'), text)
    if (!this.#isListed) {
      await this.#codex.addMarketplace(this.#scratch)
      this.#isListed = true
    }
    await this.#codex.addPlugin(this.#selector)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#isListed) return
    try {
      await this.#codex.removePlugin(this.#selector)
    } finally {
      await this.#codex.removeMarketplace(this.#marketplace)
      await rm(this.#scratch, { recursive: true, force: true })
    }
  }

  // Puts the mod's status in this session's footer over the status line the user picked, which
  // `/statusline` keeps for every session. `-c` reads its value as TOML, here an inline table of
  // JSON strings, which TOML reads as its own.
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

  // A workspace's own, `modkit-dev-atuin-3fa2b1`: Codex's config is the user's, so another
  // `modkit dev` of the same mod, from another checkout, registers beside this one, not over it.
  get #marketplace(): string {
    const hash = createHash('sha256').update(this.#scratch).digest('hex')
    return `modkit-dev-${this.#plugin}-${hash.slice(0, WORKSPACE_HASH_CHARS)}`
  }

  get #selector(): PluginSelector {
    return new PluginSelector({ plugin: this.#plugin, marketplace: this.#marketplace })
  }
}
