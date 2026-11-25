import { isPlainObject } from 'es-toolkit/predicate'

import type { ShellCall, ShellResult, ToolCall, ToolResult } from '@atuin/modkit-target/host'

const OPENCODE_SHELL = 'shell'
const MOD_SHELL = 'Bash'

const modToolOf = (tool: string): string => (tool === OPENCODE_SHELL ? MOD_SHELL : tool)

export interface OcCall {
  tool: string
  id: string
  input: unknown
}

interface OcBlock {
  type: string
  text?: string
}

export interface OcResult {
  output?: unknown
  content?: readonly OcBlock[] | string
  metadata?: unknown
}

type Json = Readonly<Record<string, unknown>>

const recordOf = (value: unknown): Json => (isPlainObject(value) ? value : {})

export function shellCallOf({ call, cwd }: { call: OcCall; cwd: string }): ShellCall | undefined {
  const { command, workdir } = recordOf(call.input)
  if (call.tool !== OPENCODE_SHELL || typeof command !== 'string') return undefined
  return { id: call.id, command, cwd: typeof workdir === 'string' ? workdir : cwd }
}

export const toolCallOf = ({ call, cwd }: { call: OcCall; cwd: string }): ToolCall => ({
  id: call.id,
  tool: modToolOf(call.tool),
  input: recordOf(call.input),
  cwd,
})

function textOf(content: OcResult['content']): string {
  if (typeof content === 'string') return content
  return (content ?? [])
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('\n')
}

export function shellResultOf({
  call,
  result,
  cwd,
}: {
  call: OcCall
  result: OcResult
  cwd: string
}): ShellResult | undefined {
  const shell = shellCallOf({ call, cwd })
  const { status, exit } = recordOf(result.metadata)
  if (shell === undefined || status === 'running') return undefined
  const { output: structured } = recordOf(result.output)
  const exitCode = typeof exit === 'number' ? exit : null
  return {
    ...shell,
    output: typeof structured === 'string' ? structured : textOf(result.content),
    exitCode,
    failed: exitCode !== 0,
  }
}

export const toolResultOf = ({
  call,
  result,
  cwd,
}: {
  call: OcCall
  result: OcResult
  cwd: string
}): ToolResult => ({
  ...toolCallOf({ call, cwd }),
  output: textOf(result.content),
  failed: false,
})

export function withContext<Result extends OcResult>({
  result,
  context,
}: {
  result: Result
  context: string
}): Result {
  const blocks: OcBlock[] =
    typeof result.content === 'string'
      ? [{ type: 'text', text: result.content }]
      : [...(result.content ?? [])]
  return { ...result, content: [...blocks, { type: 'text', text: context }] }
}
