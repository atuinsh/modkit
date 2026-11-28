import { asRecord, type HookedCall, type HookedResult } from '@atuin/modkit-target/host'

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

export function callOf({ call, cwd }: { call: OcCall; cwd: string }): HookedCall {
  const input = asRecord(call.input)
  const { command, workdir } = input
  if (call.tool === OPENCODE_SHELL && typeof command === 'string') {
    return { kind: 'shell', id: call.id, command, cwd: typeof workdir === 'string' ? workdir : cwd }
  }
  return { kind: 'tool', id: call.id, tool: modToolOf(call.tool), input, cwd }
}

function textOf(content: OcResult['content']): string {
  if (typeof content === 'string') return content
  return (content ?? [])
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('\n')
}

export function resultOf({
  call,
  result,
  cwd,
}: {
  call: OcCall
  result: OcResult
  cwd: string
}): HookedResult | undefined {
  const parsed = callOf({ call, cwd })
  if (parsed.kind === 'tool') {
    return { ...parsed, output: textOf(result.content), failed: false }
  }
  const { status, exit } = asRecord(result.metadata)
  if (status === 'running') return undefined
  const { output: structured } = asRecord(result.output)
  const exitCode = typeof exit === 'number' ? exit : null
  return {
    ...parsed,
    output: typeof structured === 'string' ? structured : textOf(result.content),
    exitCode,
    failed: exitCode !== 0,
  }
}

// A call opencode ended with an error rather than a result, as the mod's handlers take it.
export function failedResultOf({
  call,
  message,
  cwd,
}: {
  call: OcCall
  message: string
  cwd: string
}): HookedResult {
  const parsed = callOf({ call, cwd })
  return parsed.kind === 'shell'
    ? { ...parsed, output: message, exitCode: null, failed: true }
    : { ...parsed, output: message, failed: true }
}

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
