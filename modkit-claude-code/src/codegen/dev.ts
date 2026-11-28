import { globSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { DevInput, DevSpec, Env } from '@atuin/modkit-target'

// Claude Code writes a session's transcript, `projects/<the cwd as a name>/<id>.jsonl` under its
// config dir, once the session has a message; a session that quit before one can't be resumed.
function hasTranscript({ env, id }: { env: Env; id: string }): boolean {
  const config = env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude')
  return globSync(`projects/*/${id}.jsonl`, { cwd: config }).length > 0
}

/** Claude Code on a build, which it watches as a `--plugin-dir` and reloads on its own. */
export const claudeCodeDev = ({ out, env }: DevInput): DevSpec => ({
  reload: 'watched',
  // Types and a tsconfig.json for editing the plugin, which it writes into a `--plugin-dir`.
  writes: ['tsconfig.json', '.claude-plugin/types'],
  // A session's id is new to Claude Code until it writes the session's transcript.
  command: ({ id }) => ({
    program: 'claude',
    args: ['--plugin-dir', out, hasTranscript({ env, id }) ? '--resume' : '--session-id', id],
    env: {},
  }),
})
