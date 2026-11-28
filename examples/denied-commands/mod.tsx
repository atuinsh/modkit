import { mod, type Verdict } from '@atuin/modkit'

const DENIED = ['git push --force', 'rm -rf /'] as const

interface Settings {
  /** Commands the agent may not run, each matched against a command line's first words */
  denied?: readonly string[]
  /** What the agent is told when it tries one */
  reason?: string
  /** Put each one to you instead, where somebody can be asked */
  ask?: boolean
}

export default mod(
  ({
    denied = DENIED,
    reason = 'The denied-commands mod denies this command.',
    ask = false,
  }: Settings) => {
    const isDenied = (command: string): boolean =>
      denied.some((words) => command === words || command.startsWith(`${words} `))
    const verdict: Verdict = ask ? { ask: reason, otherwise: 'deny' } : { deny: reason }
    return {
      beforeShell: (call) => (isDenied(call.command.trim()) ? verdict : undefined),
    }
  },
)
