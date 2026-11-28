import { globSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { DevCommand, DevInput, DevSession, DevSpec } from '@atuin/modkit-target'

/** Claude Code on a build, which it watches as a `--plugin-dir` and reloads on its own. */
export class ClaudeCodeDev implements DevSpec {
  readonly reload = 'watched'
  // Types and a tsconfig.json for editing the plugin, which it writes into a `--plugin-dir`.
  readonly writes: readonly string[] = ['tsconfig.json', '.claude-plugin/types']
  readonly #out: string
  readonly #config: string

  constructor({ out, env }: DevInput) {
    this.#out = out
    this.#config = env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude')
  }

  // A session's id is new to Claude Code until it writes the session's transcript.
  readonly command = ({ id }: DevSession): DevCommand => {
    const session = this.#hasTranscript(id) ? '--resume' : '--session-id'
    return { program: 'claude', args: ['--plugin-dir', this.#out, session, id], env: {} }
  }

  // Claude Code writes a session's transcript, `projects/<the cwd as a name>/<id>.jsonl` under its
  // config dir, once the session has a message; a session that quit before one can't be resumed.
  #hasTranscript(id: string): boolean {
    return globSync(`projects/*/${id}.jsonl`, { cwd: this.#config }).length > 0
  }
}
