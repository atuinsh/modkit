import * as v from 'valibot'

import { Status, mod } from '@atuin/modkit'
import { query, useQuery } from '@atuin/modkit/ui/hooks'

const shortened = ({ path, home }: { path: string; home: string | undefined }): string =>
  home !== undefined && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path

const root = query({
  id: 'root',
  schema: v.nullable(v.string()),
  initial: null,
  on: ['session.start', 'turn.end'],
  fetch: async (harness) => {
    const [path, home] = await Promise.all([harness.root(), harness.env('HOME')])
    return shortened({ path, home })
  },
})

export default mod(() => {
  const current = useQuery(root)
  return {
    status: () => current.value !== null && <Status>{current.value}</Status>,
  }
})
