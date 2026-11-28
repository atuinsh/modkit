import { execFile } from 'node:child_process'

import type { RunOptions, RunResult } from '@atuin/modkit-target/host'

const MAX_OUTPUT_BYTES = 16_777_216

function combineSignals({
  signal,
  timeoutMs,
}: {
  signal: AbortSignal | undefined
  timeoutMs: number | undefined
}): AbortSignal | undefined {
  const timed = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
  if (signal !== undefined && timed !== undefined) return AbortSignal.any([signal, timed])
  return signal ?? timed
}

async function execFileRaw({
  command,
  args,
  cwd,
  signal,
}: {
  command: string
  args: readonly string[]
  cwd?: string
  signal?: AbortSignal
}): Promise<{ stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; stderr: string }>()
  execFile(
    command,
    args,
    {
      ...(cwd !== undefined && { cwd }),
      ...(signal !== undefined && { signal }),
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
    },
    (...[error, stdout, stderr]) => {
      if (error !== null) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    },
  )
  return promise
}

// A command that ran and failed has a number for a code; one that couldn't start, a name.
function failedRun({ command, error }: { command: string; error: unknown }): RunResult {
  if (!Error.isError(error)) throw error
  const code: unknown = 'code' in error ? error.code : undefined
  const isUnstarted = typeof code === 'string' && code !== 'ABORT_ERR'
  if (isUnstarted) {
    throw new Error(`couldn't run ${command}: ${error.message}`, { cause: error })
  }
  const stdout: unknown = 'stdout' in error ? error.stdout : undefined
  const stderr: unknown = 'stderr' in error ? error.stderr : undefined
  return {
    exitCode: typeof code === 'number' ? code : null,
    stdout: typeof stdout === 'string' ? stdout : '',
    stderr: typeof stderr === 'string' ? stderr : '',
  }
}

/** Run `command` with `args` and return its UTF-8 stdout, rejecting on non-zero exit or spawn failure. */
export async function execFileStdout({
  command,
  args,
  cwd,
  signal,
}: {
  command: string
  args: readonly string[]
  cwd?: string
  signal?: AbortSignal
}): Promise<string> {
  const { stdout } = await execFileRaw({
    command,
    args,
    ...(cwd !== undefined && { cwd }),
    ...(signal !== undefined && { signal }),
  })
  return stdout
}

export async function run({
  argv,
  options,
  cwd,
  signal,
}: {
  argv: readonly string[]
  options: RunOptions | undefined
  cwd: string
  signal?: AbortSignal
}): Promise<RunResult> {
  const [command, ...args] = argv
  if (command === undefined) throw new Error('harness.run was given no command')
  const combined = combineSignals({ signal, timeoutMs: options?.timeoutMs })
  try {
    const { stdout, stderr } = await execFileRaw({
      command,
      args,
      cwd: options?.cwd ?? cwd,
      ...(combined !== undefined && { signal: combined }),
    })
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    return failedRun({ command, error })
  }
}

// The checkout `cwd` is in, or `cwd` itself outside one, for a harness that names only a directory.
export async function findProjectRoot(cwd: string, signal?: AbortSignal): Promise<string> {
  try {
    const found = await run({
      argv: ['git', 'rev-parse', '--show-toplevel'],
      options: undefined,
      cwd,
      ...(signal !== undefined && { signal }),
    })
    const root = found.stdout.trim()
    return found.exitCode === 0 && root !== '' ? root : cwd
  } catch {
    return cwd
  }
}
