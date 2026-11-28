import * as v from 'valibot'

import {
  Button,
  Column,
  Markdown,
  Pane,
  Row,
  Text,
  mod,
  type ModNode,
  type Press,
} from '@atuin/modkit'
import { state, useHarness, useState } from '@atuin/modkit/ui/hooks'

const MODEL = 'haiku'
const MAX_TOKENS = 300
const TAIL_CHARS = 4000
const SYSTEM =
  'Say in two sentences why this shell command failed and what would likely fix it. Plain text.'

interface Failure {
  command: string
  output: string
}

const lastFailure = state({
  id: 'lastFailure',
  schema: v.nullable(v.object({ command: v.string(), output: v.string() })),
  initial: null,
})

const explanation = state({ id: 'explanation', schema: v.nullable(v.string()), initial: null })

function Explained({
  failure,
  answer,
  onExplain,
  onCopy,
}: {
  failure: Failure
  answer: string | null
  onExplain: () => Promise<void>
  onCopy: (press: Press) => Promise<void>
}): ModNode {
  return (
    <Column gap={1}>
      <Text bold>$ {failure.command}</Text>
      {answer === null ? <Text tone="dim">Not explained yet.</Text> : <Markdown text={answer} />}
      <Row gap={2}>
        <Button hotkey="e" onPress={onExplain}>
          Explain
        </Button>
        {answer !== null && (
          <Button hotkey="y" onPress={onCopy}>
            Copy
          </Button>
        )}
      </Row>
    </Column>
  )
}

export default mod(() => {
  const harness = useHarness()
  const [failure, setFailure] = useState(lastFailure)
  const [answer, setAnswer] = useState(explanation)

  const explain = async (failed: Failure): Promise<void> => {
    const reply = await harness.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: `$ ${failed.command}\n${failed.output}`,
      maxTokens: MAX_TOKENS,
      effort: 'low',
    })
    setAnswer(reply.isAnswered ? reply.text : `No answer: ${reply.detail}.`)
  }

  return {
    afterShell: (result) => {
      if (!result.failed) return
      setFailure({ command: result.command, output: result.output.slice(-TAIL_CHARS) })
      setAnswer(null)
    },
    commands: {
      explain: {
        description: 'Toggle the pane that explains the last failed command',
        pane: () => (
          <Pane title="Last failure">
            {failure === null ? (
              <Text tone="dim">Nothing has failed yet.</Text>
            ) : (
              <Explained
                failure={failure}
                answer={answer}
                onExplain={async () => explain(failure)}
                onCopy={async ({ surface }) => {
                  await harness.copy(answer ?? '', { surface })
                }}
              />
            )}
          </Pane>
        ),
      },
    },
  }
})
