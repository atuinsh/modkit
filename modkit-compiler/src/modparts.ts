import { keysOf, partsNamed, type ModCall } from './entry.ts'
import { syntax } from './program.ts'

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

export type ModpartCounts = Readonly<Record<ModpartName, number>>

function countOf({ mod, name }: { mod: ModCall; name: ModpartName }): number {
  const counts = partsNamed({ mod, name }).map((part) => {
    if (syntax.isArrayLiteralExpression(part)) return part.elements.length
    return keysOf(part)?.length ?? 1
  })
  return Math.max(0, ...counts)
}

export const modpartsIn = (mod: ModCall): ModpartCounts => ({
  status: countOf({ mod, name: 'status' }),
  commands: countOf({ mod, name: 'commands' }),
  panes: countOf({ mod, name: 'panes' }),
  beforeShell: countOf({ mod, name: 'beforeShell' }),
  afterShell: countOf({ mod, name: 'afterShell' }),
  beforeTool: countOf({ mod, name: 'beforeTool' }),
  afterTool: countOf({ mod, name: 'afterTool' }),
  toolCards: countOf({ mod, name: 'toolCards' }),
})
