import { mod } from '@atuin/modkit'

// A shell reports a command a signal ended as 128 plus the signal's number.
const SIGINT_EXIT = 130
const SIGKILL_EXIT = 137
const SIGTERM_EXIT = 143

const SIGNALS = new Map([
  [SIGINT_EXIT, 'interrupted (SIGINT)'],
  [SIGKILL_EXIT, 'killed (SIGKILL), usually by the out-of-memory killer'],
  [SIGTERM_EXIT, 'terminated (SIGTERM), usually by a timeout'],
])

export default mod(() => ({
  afterShell: ({ command, exitCode }) => {
    const meaning = exitCode === null ? undefined : SIGNALS.get(exitCode)
    return exitCode === null || meaning === undefined
      ? undefined
      : { context: `\`${command}\` exited ${exitCode}: ${meaning}.` }
  },
}))
