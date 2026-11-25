import { isPlainObject } from 'es-toolkit/predicate'

import type { Verdict } from '@atuin/modkit-target/host'

import type { Decision } from './hooks'

export interface Answer {
  action: 'accept' | 'decline' | 'cancel'
  content?: Readonly<Record<string, unknown>>
}

export const ASK_SCHEMA = {
  type: 'object',
  properties: { run: { type: 'boolean', title: 'Go ahead', default: false } },
  required: ['run'],
} as const

export interface Decided {
  decision: Decision
  note?: string
}

const NONE: Decided = { decision: { kind: 'none' } }

function unasked(ask: { ask: string; otherwise: 'allow' | 'deny' }): Decided {
  if (ask.otherwise === 'deny') return { decision: { kind: 'deny', reason: ask.ask } }
  return { ...NONE, note: ask.ask }
}

export async function decide({
  verdict,
  canAsk,
  elicit,
}: {
  verdict: Verdict
  canAsk: boolean
  elicit: (message: string) => Promise<Answer | undefined>
}): Promise<Decided> {
  if (verdict === undefined) return NONE
  if ('deny' in verdict) return { decision: { kind: 'deny', reason: verdict.deny } }
  if (!canAsk) return unasked(verdict)
  const answer = await elicit(verdict.ask)
  if (answer === undefined) return unasked(verdict)
  if (answer.action === 'accept' && answer.content?.['run'] === true) return NONE
  return { decision: { kind: 'deny', reason: `${verdict.ask}\n\nThe person said no.` } }
}

export function answerOf(result: unknown): Answer | undefined {
  if (!isPlainObject(result)) return undefined
  const { action, content }: Readonly<Record<string, unknown>> = result
  if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return undefined
  return { action, ...(isPlainObject(content) && { content }) }
}
