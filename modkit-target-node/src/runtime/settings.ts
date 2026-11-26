import { isPlainObject } from 'es-toolkit/predicate'
import * as v from 'valibot'

import type { Options } from '@atuin/modkit-target/host'

type OptionValue = Options[string]

export type SettingDecl =
  | {
      name: string
      kind: 'string'
      choices?: readonly string[]
      default?: string
      isRequired: boolean
    }
  | { name: string; kind: 'strings'; default?: readonly string[]; isRequired: boolean }
  | { name: string; kind: 'number'; default?: number; isRequired: boolean }
  | { name: string; kind: 'boolean'; default?: boolean; isRequired: boolean }

export type Settings =
  | { isOk: true; options: Options; problems: readonly string[] }
  | { isOk: false; problems: readonly string[] }

const StringsSchema = v.array(v.string())

function heldBy({ decl, value }: { decl: SettingDecl; value: unknown }): OptionValue | undefined {
  switch (decl.kind) {
    case 'string':
      if (typeof value !== 'string') return undefined
      return decl.choices === undefined || decl.choices.includes(value) ? value : undefined
    case 'strings':
      return v.is(StringsSchema, value) ? value : undefined
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    case 'boolean':
      break
  }
  return typeof value === 'boolean' ? value : undefined
}

const KIND_WORDS: Readonly<Record<SettingDecl['kind'], string>> = {
  string: 'a string',
  strings: 'a list of strings',
  number: 'a number',
  boolean: 'true or false',
}

const wanted = (decl: SettingDecl): string =>
  decl.kind === 'string' && decl.choices !== undefined
    ? `one of ${decl.choices.map((choice) => JSON.stringify(choice)).join(', ')}`
    : KIND_WORDS[decl.kind]

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

interface Read {
  decl: SettingDecl
  value: OptionValue | undefined
  problem: string[]
}

function readOf({
  decl,
  given,
  where,
}: {
  decl: SettingDecl
  given: unknown
  where: string
}): Read {
  const value = given === undefined ? undefined : heldBy({ decl, value: given })
  const problem =
    given !== undefined && value === undefined
      ? [`${where} sets ${decl.name} to ${JSON.stringify(given)}, but it takes ${wanted(decl)}`]
      : []
  return { decl, value: value ?? decl.default, problem }
}

export function settingsOf({
  decls,
  given,
  where,
}: {
  decls: readonly SettingDecl[]
  given: unknown
  where: string
}): Settings {
  if (!isPlainObject(given)) {
    const defaults = settingsOf({ decls, given: {}, where })
    const problem = `${where} isn't a JSON object of settings, so it was ignored`
    return { ...defaults, problems: [problem, ...defaults.problems] }
  }
  const json: Readonly<Record<string, unknown>> = given
  const known = new Set(decls.map((decl) => decl.name))
  const unknown = Object.keys(json)
    .filter((name) => !known.has(name))
    .map((name) => `${where} sets ${name}, which this mod has no setting for`)
  const read = decls.map((decl) => readOf({ decl, given: json[decl.name], where }))
  const problems = [...unknown, ...read.flatMap((one) => one.problem)]
  const missing = read
    .filter((one) => one.value === undefined && one.decl.isRequired)
    .map((one) => `this mod needs ${one.decl.name} set in ${where}, as ${wanted(one.decl)}`)
  if (missing.length > 0) return { isOk: false, problems: [...problems, ...missing] }
  const options = Object.fromEntries(
    read.flatMap((one) => (one.value === undefined ? [] : [[one.decl.name, one.value]])),
  )
  return { isOk: true, options, problems }
}

export function settingsFrom({
  decls,
  text,
  path,
}: {
  decls: readonly SettingDecl[]
  text: string | undefined
  path: string
}): Settings {
  return settingsOf({ decls, given: text === undefined ? {} : parsed(text), where: path })
}
