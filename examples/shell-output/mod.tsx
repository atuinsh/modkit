import * as v from 'valibot'

import { Button, Column, Pane, Text, mod, type ModNode } from '@atuin/modkit'
import { state, useState } from '@atuin/modkit/ui/hooks'

const KEPT = 5
const TAIL_CHARS = 2000

interface Ran {
  id: string
  command: string
  output: string
}

const RanSchema = v.object({ id: v.string(), command: v.string(), output: v.string() })

const commands = state({ id: 'commands', schema: v.array(RanSchema), initial: [] })
const pickedOne = state({ id: 'picked', schema: v.nullable(RanSchema), initial: null })

function Picks({ ran, onPick }: { ran: readonly Ran[]; onPick: (one: Ran) => void }): ModNode {
  if (ran.length === 0) return <Text tone="dim">No commands yet.</Text>
  return (
    <Column>
      {ran.map((one, index) => (
        <Button
          key={one.id}
          hotkey={String(index + 1)}
          onPress={() => {
            onPick(one)
          }}
        >
          {one.command}
        </Button>
      ))}
    </Column>
  )
}

export default mod(() => {
  const [ran, setRan] = useState(commands)
  const [picked, setPicked] = useState(pickedOne)

  return {
    afterShell: (result) => {
      const one = {
        id: result.id,
        command: result.command,
        output: result.output.slice(-TAIL_CHARS),
      }
      setRan((kept) => [one, ...kept].slice(0, KEPT))
    },
    commands: {
      commands: {
        description: "Toggle the pane of this session's latest shell commands",
        pane: () => (
          <Pane title="Commands">
            <Picks ran={ran} onPick={setPicked} />
          </Pane>
        ),
      },
    },
    panes: [
      () =>
        picked !== null && (
          <Pane
            id="output"
            title={`$ ${picked.command}`}
            onClose={() => {
              setPicked(null)
            }}
          >
            <Text>{picked.output === '' ? '(no output)' : picked.output}</Text>
          </Pane>
        ),
    ],
  }
})
