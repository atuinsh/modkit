import { open } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import * as v from 'valibot'

import type { Exit } from './hooks'

const TAIL_BYTES = 1_048_576
const LOOKS = 5
const LOOK_GAP_MS = 20

export const UNKNOWN_EXIT: Exit = { exitCode: null, failed: false }

const EntrySchema = v.object({
  payload: v.object({
    type: v.literal('item_completed'),
    item: v.object({
      type: v.literal('CommandExecution'),
      id: v.string(),
      exit_code: v.optional(v.unknown()),
      status: v.optional(v.unknown()),
    }),
  }),
})

function parsed(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function exitOn({ line, id }: { line: string; id: string }): Exit | undefined {
  // Most lines aren't about the command; the id check spares parsing them.
  if (!line.includes(id)) return undefined
  const entry = v.safeParse(EntrySchema, parsed(line))
  if (!entry.success || entry.output.payload.item.id !== id) return undefined
  const { exit_code: code, status } = entry.output.payload.item
  const exitCode = typeof code === 'number' ? code : null
  return { exitCode, failed: status === 'failed' || (exitCode !== null && exitCode !== 0) }
}

const recordedExit = ({ text, id }: { text: string; id: string }): Exit | undefined =>
  text
    .split('\n')
    .toReversed()
    .map((line) => exitOn({ line, id }))
    .find((found) => found !== undefined)

async function tailOf(path: string): Promise<string | undefined> {
  try {
    const file = await open(path, 'r')
    try {
      const { size } = await file.stat()
      const length = Math.min(size, TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      await file.read({ buffer, position: size - length })
      return buffer.toString('utf8')
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}

export async function exitFromTranscript({
  path,
  id,
}: {
  path: string
  id: string
}): Promise<Exit> {
  for (let look = 0; look < LOOKS; look += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each look waits for Codex to write the item
    const text = await tailOf(path)
    const exit = text === undefined ? undefined : recordedExit({ text, id })
    if (exit !== undefined) return exit
    // oxlint-disable-next-line no-await-in-loop -- the gap is the point: Codex writes meanwhile
    await sleep(LOOK_GAP_MS)
  }
  return UNKNOWN_EXIT
}
