import * as v from 'valibot'

import { Status, mod, type ToolResult } from '@atuin/modkit'
import { state, useState } from '@atuin/modkit/ui/hooks'

const edited = state({ id: 'edited', schema: v.array(v.string()), initial: [] })

export default mod(() => {
  const [files, setFiles] = useState(edited)
  const count = (result: ToolResult): void => {
    const file = result.input['file_path']
    if (result.failed || typeof file !== 'string') return
    setFiles((seen) => (seen.includes(file) ? seen : [...seen, file]))
  }
  return {
    afterTool: { Write: count, Edit: count },
    status: () => files.length > 0 && <Status>{`${files.length} edited`}</Status>,
  }
})
