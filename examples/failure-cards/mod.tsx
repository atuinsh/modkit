import * as v from 'valibot'

import { Button, Column, Text, mod, type ModNode } from '@atuin/modkit'
import { state, useHarness, useState } from '@atuin/modkit/ui/hooks'

const TAIL_CHARS = 2000

interface Failure {
  command: string
  exitCode: number | null
  tail: string
  isAdded: boolean
}

const failed = state({
  id: 'failed',
  schema: v.record(
    v.string(),
    v.object({
      command: v.string(),
      exitCode: v.nullable(v.number()),
      tail: v.string(),
      isAdded: v.boolean(),
    }),
  ),
  initial: {},
})

const exitedOf = (failure: Failure): string => `exited ${failure.exitCode ?? 'without a code'}`

function FailureCard({
  failure,
  onAdd,
}: {
  failure: Failure
  onAdd: () => Promise<void>
}): ModNode {
  const last = failure.tail.trimEnd().split('\n').at(-1) ?? ''
  return (
    <Column border="round" borderTone="dim" paddingX={1}>
      <Text tone="error" bold>
        {exitedOf(failure)}
      </Text>
      {last !== '' && <Text tone="dim">{last}</Text>}
      <Button onPress={onAdd}>{failure.isAdded ? 'Added to context' : 'Add to context'}</Button>
    </Column>
  )
}

export default mod(() => {
  const harness = useHarness()
  const [failures, setFailures] = useState(failed)

  const add = async (id: string): Promise<void> => {
    const failure = failures[id]
    if (failure === undefined || failure.isAdded) return
    await harness.inject(`\`${failure.command}\` ${exitedOf(failure)}:\n${failure.tail}`)
    setFailures((all) => ({ ...all, [id]: { ...failure, isAdded: true } }))
  }

  return {
    afterShell: (result) => {
      if (!result.failed) return
      const { command, exitCode } = result
      const failure = { command, exitCode, tail: result.output.slice(-TAIL_CHARS), isAdded: false }
      setFailures((all) => ({ ...all, [result.id]: failure }))
    },
    toolCards: {
      Bash: (row) => {
        const failure = failures[row.id]
        return failure === undefined ? null : (
          <FailureCard failure={failure} onAdd={async () => add(row.id)} />
        )
      },
    },
  }
})
