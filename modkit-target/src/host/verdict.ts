import type { Verdict } from '@atuin/modkit'

/** Resolved outcome of a mod's {@link Verdict} after applying confirmation or fallback policy. */
export type VerdictOutcome =
  | { readonly allow: true; readonly note?: string }
  | { readonly allow: false; readonly reason: string }

const refusedReason = (ask: string): string => `${ask}\n\nThe person said no.`

function fallback(ask: {
  readonly ask: string
  readonly otherwise: 'allow' | 'deny'
}): VerdictOutcome {
  return ask.otherwise === 'deny'
    ? { allow: false, reason: ask.ask }
    : { allow: true, note: ask.ask }
}

/** Domain wrapper around a mod's {@link Verdict} with bound resolution policy. */
export class ModVerdict {
  readonly #raw: Verdict

  private constructor(raw: Verdict) {
    this.#raw = raw
  }

  /** Wrap a {@link Verdict} returned by `beforeShell` or `beforeTool`. */
  static from(verdict: Verdict): ModVerdict {
    return new ModVerdict(verdict)
  }

  /** Resolve this verdict against an interactive confirmation prompt. */
  async resolve({
    canAsk,
    confirm,
  }: {
    canAsk: boolean
    confirm: (ask: string) => Promise<boolean | undefined>
  }): Promise<VerdictOutcome> {
    const verdict = this.#raw
    if (verdict === undefined) return { allow: true }
    if ('deny' in verdict) return { allow: false, reason: verdict.deny }
    if (!canAsk) return fallback(verdict)
    const accepted = await confirm(verdict.ask)
    if (accepted === undefined) return fallback(verdict)
    return accepted ? { allow: true } : { allow: false, reason: refusedReason(verdict.ask) }
  }
}
