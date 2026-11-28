import * as v from 'valibot'

import { Status, mod } from '@atuin/modkit'
import { query, useQuery } from '@atuin/modkit/ui/hooks'

const REFRESH_MS = 30_000

const branch = query({
  id: 'branch',
  schema: v.nullable(v.string()),
  initial: null,
  everyMs: REFRESH_MS,
  on: ['session.start', 'shell.after'],
  fetch: async (harness) => {
    const run = await harness.run(['git', 'branch', '--show-current'])
    return run.exitCode === 0 ? run.stdout.trim() : null
  },
})

export default mod(() => {
  const current = useQuery(branch)
  return {
    status: () => current.value !== null && <Status>{current.value}</Status>,
  }
})
