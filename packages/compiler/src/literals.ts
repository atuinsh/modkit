import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import { keysOf, partsNamed, type ModCall } from './entry.ts'
import { callsIn, modkitExports } from './modkit.ts'
import {
  isStringLiteralType,
  resolvedSymbol,
  type Node,
  type Project,
  type TsSymbol,
} from './program.ts'

function envMethod(project: Project): TsSymbol | undefined {
  const harness = modkitExports(project).find((symbol) => symbol.name === 'Harness')
  return [...(harness?.getMembers().values() ?? [])].find((member) => member.name === 'env')
}

function textOf({
  project,
  node,
}: {
  project: Project
  node: Node | undefined
}): string | undefined {
  if (node === undefined) return undefined
  const type = project.checker.getTypeAtLocation(node)
  return type !== undefined && isStringLiteralType(type) ? type.value : undefined
}

interface ToolNames {
  before: string[]
  after: string[]
  cards: string[]
}

/** Collected static environment variable and tool names, plus any validation diagnostics. */
export interface Literals {
  /** Sorted unique environment variable names passed to `harness.env()`. */
  env: string[]
  tools: ToolNames
  diagnostics: Diagnostic[]
}

const TOOL_PARTS = [
  ['beforeTool', 'before'],
  ['afterTool', 'after'],
  ['toolCards', 'cards'],
] as const

interface ToolsRead {
  names: string[]
  diagnostics: Diagnostic[]
}

function toolsOf({
  mod,
  part,
}: {
  mod: ModCall
  part: (typeof TOOL_PARTS)[number][0]
}): ToolsRead[] {
  return partsNamed({ mod, name: part }).map((written) => {
    const names = keysOf(written)
    if (names === undefined) {
      const message = `${part}'s tools are an object literal's written-out keys: a harness hooks a tool by its name`
      return {
        names: [],
        diagnostics: [diagnosticAt({ code: 'tool-name', message, node: written })],
      }
    }
    // A card only draws, so it goes under Bash's rows too; the shell parts decide on Bash.
    if (part === 'toolCards' || !names.includes('Bash')) return { names, diagnostics: [] }
    const message = `${part}.Bash is ${part.replace('Tool', 'Shell')}, which hands it the command`
    return { names: [], diagnostics: [diagnosticAt({ code: 'tool-name', message, node: written })] }
  })
}

const sorted = (names: readonly string[]): string[] => [...new Set(names)].toSorted()

function toolsIn(mod: ModCall): { tools: ToolNames; diagnostics: Diagnostic[] } {
  const found = TOOL_PARTS.map(([part, side]) => ({ side, read: toolsOf({ mod, part }) }))
  const namesFor = (side: keyof ToolNames): string[] =>
    sorted(
      found.flatMap((one) => (one.side === side ? one.read.flatMap((read) => read.names) : [])),
    )
  return {
    tools: { before: namesFor('before'), after: namesFor('after'), cards: namesFor('cards') },
    diagnostics: found.flatMap((one) => one.read.flatMap((read) => read.diagnostics)),
  }
}

function envIn(project: Project): { env: string[]; diagnostics: Diagnostic[] } {
  const env = envMethod(project)
  if (env === undefined) return { env: [], diagnostics: [] }
  const reads = project.files.flatMap((file) =>
    callsIn(file).filter(
      (call) => resolvedSymbol({ checker: project.checker, node: call.expression })?.id === env.id,
    ),
  )
  const names = reads.map((call) => ({ call, name: textOf({ project, node: call.arguments[0] }) }))
  const message =
    'harness.env names its variable with a string literal: Claude Code lists the variables a mod reads'
  return {
    env: sorted(names.flatMap(({ name }) => (name === undefined ? [] : [name]))),
    diagnostics: names.flatMap(({ call, name }) =>
      name === undefined ? [diagnosticAt({ code: 'env-name', message, node: call })] : [],
    ),
  }
}

export function literalsIn({ project, mod }: { project: Project; mod: ModCall }): Literals {
  const env = envIn(project)
  const tools = toolsIn(mod)
  return {
    env: env.env,
    tools: tools.tools,
    diagnostics: [...env.diagnostics, ...tools.diagnostics],
  }
}
