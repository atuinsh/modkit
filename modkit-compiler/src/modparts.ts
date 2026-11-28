import { ModDiagnostic, type Place } from './diagnostics.ts'
import { ModAst } from './entry.ts'
import { syntax, type Node } from './program.ts'

export const MODPARTS = [
  'status',
  'commands',
  'panes',
  'beforeShell',
  'afterShell',
  'beforeTool',
  'afterTool',
  'toolCards',
] as const

export type ModpartName = (typeof MODPARTS)[number]

/** How many of one modpart a mod writes, and where its parts object first names it. */
export interface ModpartUsage {
  count: number
  at: Place
}

/** Each modpart the mod writes, or `undefined` for one it does not. */
export type Modparts = Readonly<Record<ModpartName, ModpartUsage | undefined>>

function countOf(part: Node): number {
  if (syntax.isArrayLiteralExpression(part)) return part.elements.length
  return ModAst.keysOf(part)?.length ?? 1
}

function usageOf({ mod, name }: { mod: ModAst; name: ModpartName }): ModpartUsage | undefined {
  const parts = mod.parts(name)
  const [first] = parts
  const count = Math.max(0, ...parts.map((part) => countOf(part)))
  return first === undefined || count === 0
    ? undefined
    : { count, at: ModDiagnostic.placeAt(first) }
}

export const modpartsIn = (mod: ModAst): Modparts => ({
  status: usageOf({ mod, name: 'status' }),
  commands: usageOf({ mod, name: 'commands' }),
  panes: usageOf({ mod, name: 'panes' }),
  beforeShell: usageOf({ mod, name: 'beforeShell' }),
  afterShell: usageOf({ mod, name: 'afterShell' }),
  beforeTool: usageOf({ mod, name: 'beforeTool' }),
  afterTool: usageOf({ mod, name: 'afterTool' }),
  toolCards: usageOf({ mod, name: 'toolCards' }),
})
