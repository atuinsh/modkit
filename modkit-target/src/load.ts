/**
 * Loading the targets a mod lists from the mod's own `node_modules`, so a mod installs only the
 * targets it builds for.
 *
 * @module
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as v from 'valibot'

import type { Diagnostic, ModpartName } from '@atuin/modkit-compiler'

import type { Capabilities } from './capabilities.ts'
import { issuesAt, listedIn, manifestError, type Listed, type Read } from './manifest.ts'
import type { Target } from './target.ts'

/** A target the mod lists, loaded, with the gaps the mod accepts there and its checked options. */
export interface Selected {
  target: Target
  gaps: readonly ModpartName[]
  options: unknown
}

const SupportSchema = v.variant('kind', [
  v.object({ kind: v.literal('native') }),
  v.object({ kind: v.literal('lowered'), why: v.string() }),
  v.object({ kind: v.literal('dropped'), why: v.string() }),
])

const CapabilitiesSchema: v.GenericSchema<unknown, Capabilities> = v.object({
  status: SupportSchema,
  commands: SupportSchema,
  panes: SupportSchema,
  beforeShell: SupportSchema,
  afterShell: SupportSchema,
  beforeTool: SupportSchema,
  afterTool: SupportSchema,
  toolCards: SupportSchema,
})

const isSchema = (value: unknown): value is v.GenericSchema =>
  v.is(v.object({ kind: v.literal('schema'), async: v.literal(false) }), value)

const isFunction = (value: unknown): value is Target['build'] => typeof value === 'function'

// The module is another package's, so its shape is checked here rather than taken from its types.
const moduleSchemaOf = (name: string): v.GenericSchema<unknown, { target: Target }> =>
  v.object({
    target: v.object({
      name: v.literal(name),
      capabilities: CapabilitiesSchema,
      options: v.custom<v.GenericSchema>(isSchema, 'options is a Valibot schema'),
      build: v.custom<Target['build']>(isFunction, 'build is a function'),
    }),
  })

const packageOf = (name: string): string => `@atuin/modkit-${name}`

const missing = ({ message, dir }: { message: string; dir: string }): Read<never> => ({
  isOk: false,
  diagnostics: [manifestError({ code: 'target-missing', message, dir })],
})

// Resolved from the mod's directory, where the mod installs the targets it builds for.
function entryOf({ name, dir }: { name: string; dir: string }): Read<string> {
  try {
    const entry = createRequire(join(dir, 'package.json')).resolve(`${packageOf(name)}/codegen`)
    return { isOk: true, value: entry }
  } catch {
    const message = `modkit.targets lists ${name}; add ${packageOf(name)} to the mod's devDependencies`
    return missing({ message, dir })
  }
}

async function targetAt({ name, dir }: { name: string; dir: string }): Promise<Read<Target>> {
  const entry = entryOf({ name, dir })
  if (!entry.isOk) return entry
  const module: unknown = await import(pathToFileURL(entry.value).href)
  const exported = v.safeParse(moduleSchemaOf(name), module)
  if (exported.success) return { isOk: true, value: exported.output.target }
  const [issue] = exported.issues
  const message = `${packageOf(name)}/codegen exports no target ${name}: ${issue.message}`
  return missing({ message, dir })
}

async function loaded({ listed, dir }: { listed: Listed; dir: string }): Promise<Read<Selected>> {
  const target = await targetAt({ name: listed.name, dir })
  if (!target.isOk) return target
  const options = v.safeParse(target.value.options, listed.options)
  if (!options.success) {
    const message = issuesAt({ at: `modkit.${listed.name}`, issues: options.issues })
    return { isOk: false, diagnostics: [manifestError({ code: 'target-options', message, dir })] }
  }
  return { isOk: true, value: { target: target.value, gaps: listed.gaps, options: options.output } }
}

/** Load each target the mod in `dir` lists, or say why one can't be. */
export async function targetsIn(dir: string): Promise<Read<Selected[]>> {
  const listed = listedIn(dir)
  if (!listed.isOk) return listed
  const all = await Promise.all(listed.value.map(async (one) => loaded({ listed: one, dir })))
  const diagnostics: Diagnostic[] = all.flatMap((one) => (one.isOk ? [] : one.diagnostics))
  if (diagnostics.length > 0) return { isOk: false, diagnostics }
  return { isOk: true, value: all.flatMap((one) => (one.isOk ? [one.value] : [])) }
}
