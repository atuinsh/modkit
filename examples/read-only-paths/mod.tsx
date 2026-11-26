import { mod, type ToolCall, type Verdict } from '@atuin/modkit'

const PROTECTED = ['/etc'] as const

interface Settings {
  /** Absolute paths the agent may not write under */
  paths?: readonly string[]
}

const isUnder = ({ file, paths }: { file: string; paths: readonly string[] }): boolean =>
  paths.some((path) => {
    const dir = path.replace(/\/+$/u, '')
    return file === dir || file.startsWith(`${dir}/`)
  })

export default mod(({ paths = PROTECTED }: Settings) => {
  const guard = (call: ToolCall): Verdict => {
    const file = call.input['file_path']
    const isProtected = typeof file === 'string' && isUnder({ file, paths })
    return isProtected
      ? { deny: `${file} is read-only: the read-only-paths mod's settings name it` }
      : undefined
  }
  return {
    beforeTool: { Write: guard, Edit: guard },
  }
})
