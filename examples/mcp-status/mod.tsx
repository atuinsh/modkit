import * as v from 'valibot'

import { Status, mod } from '@atuin/modkit'
import { query, useQuery } from '@atuin/modkit/ui/hooks'

const REFRESH_MS = 60_000

// oxlint-disable-next-line typescript/consistent-type-definitions -- a mod's required settings are a type, which an interface's missing index signature is not
type Settings = {
  /** The MCP server, as /mcp lists it */
  server: string
  /** The tool on that server whose answer's first line the footer shows */
  tool: string
}

const firstLine = query({
  id: 'firstLine',
  schema: v.string(),
  initial: '',
  everyMs: REFRESH_MS,
  on: ['session.start'],
  fetch: async (harness, { server, tool }: { server: string; tool: string }) => {
    const answer = await harness.mcp({ server, tool })
    return answer.isOk ? (answer.text.split('\n')[0] ?? '') : `${tool}: ${answer.reason}`
  },
})

export default mod(({ server, tool }: Settings) => {
  const line = useQuery(firstLine, { server, tool })
  return {
    status: () => line.value !== '' && <Status>{line.value}</Status>,
  }
})
