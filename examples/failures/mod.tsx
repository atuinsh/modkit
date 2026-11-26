import * as v from 'valibot'

import { Button, Column, Pane, Row, Text, mod } from '@atuin/modkit'
import { state, useHarness, useState } from '@atuin/modkit/ui/hooks'

const KEPT = 10

const failed = state({
  id: 'failed',
  schema: v.array(
    v.object({ id: v.string(), command: v.string(), exitCode: v.nullable(v.number()) }),
  ),
  initial: [],
})

interface Failure {
  id: string
  command: string
  exitCode: number | null
}

const summaryOf = (failures: readonly Failure[]): string =>
  failures
    .map((failure) => `- \`${failure.command}\` exited ${failure.exitCode ?? 'without a code'}`)
    .join('\n')

export default mod(() => {
  const [failures, setFailures] = useState(failed)
  const harness = useHarness()

  return {
    afterShell: (result) => {
      if (!result.failed) return
      const failure = { id: result.id, command: result.command, exitCode: result.exitCode }
      setFailures((kept) => [failure, ...kept].slice(0, KEPT))
    },
    commands: {
      failures: {
        description: "Toggle the pane of this session's failed commands",
        pane: () => (
          <Pane title="Failures">
            <Column gap={1}>
              {failures.length === 0 && <Text tone="dim">Nothing has failed yet.</Text>}
              {failures.map((failure) => (
                <Text key={failure.id}>
                  <Text tone="error">{failure.exitCode ?? '?'}</Text> {failure.command}
                </Text>
              ))}
              <Row gap={2}>
                <Button
                  hotkey="a"
                  onPress={async () => {
                    await harness.inject(`Commands that failed this session:
${summaryOf(failures)}`)
                  }}
                >
                  Add to context
                </Button>
                <Button
                  hotkey="c"
                  onPress={() => {
                    setFailures([])
                  }}
                >
                  Clear
                </Button>
              </Row>
            </Column>
          </Pane>
        ),
      },
    },
  }
})
