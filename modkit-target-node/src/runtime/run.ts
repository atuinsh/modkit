import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { isError } from 'es-toolkit/predicate'

import type { RunOptions, RunResult } from '@atuin/modkit-target/host'

const MAX_OUTPUT_BYTES = 16_777_216

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

// A command that ran and failed has a number for a code; one that couldn't start, a name.
function failedRun({ command, error }: { command: string; error: unknown }): RunResult {
  if (!isError(error)) throw error
  const code: unknown = 'code' in error ? error.code : undefined
  const isUnstarted = typeof code === 'string'
  if (isUnstarted) {
    throw new Error(`couldn't run ${command}: ${error.message}`, { cause: error })
  }
  return {
    exitCode: typeof code === 'number' ? code : null,
    stdout: textOf('stdout' in error ? error.stdout : undefined),
    stderr: textOf('stderr' in error ? error.stderr : undefined),
  }
}

export async function run({
  argv,
  options,
  cwd,
}: {
  argv: readonly string[]
  options: RunOptions | undefined
  cwd: string
}): Promise<RunResult> {
  const [command, ...args] = argv
  if (command === undefined) throw new Error('harness.run was given no command')
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd ?? cwd,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      ...(options?.timeoutMs !== undefined && { timeout: options.timeoutMs }),
    })
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    return failedRun({ command, error })
  }
}
