import { readFileSync } from 'node:fs'

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

function parseValue({
  decl,
  value,
}: {
  decl: SettingDecl
  value: unknown
}): OptionValue | undefined {
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

const expectedTypeText = (decl: SettingDecl): string =>
  decl.kind === 'string' && decl.choices !== undefined
    ? `one of ${decl.choices.map((choice) => JSON.stringify(choice)).join(', ')}`
    : KIND_WORDS[decl.kind]

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    return undefined
  }
}

interface ParsedEntry {
  decl: SettingDecl
  value: OptionValue | undefined
  problem: string[]
}

function parseEntry({
  decl,
  given,
  where,
}: {
  decl: SettingDecl
  given: unknown
  where: string
}): ParsedEntry {
  const value = given === undefined ? undefined : parseValue({ decl, value: given })
  const problem =
    given !== undefined && value === undefined
      ? [
          `${where} sets ${decl.name} to ${JSON.stringify(given)}, but it takes ${expectedTypeText(decl)}`,
        ]
      : []
  return { decl, value: value ?? decl.default, problem }
}

/** Validating schema for a mod's user settings, loaded from a JSON file or an inline object. */
export class SettingsSchema {
  readonly #decls: readonly SettingDecl[]

  private constructor(decls: readonly SettingDecl[]) {
    this.#decls = decls
  }

  /** Construct a schema from compiler-emitted {@link SettingDecl} entries. */
  static from(decls: readonly SettingDecl[]): SettingsSchema {
    return new SettingsSchema(decls)
  }

  /** Parse and validate `given` against this schema, anchoring problems to `where`. */
  parse(given: unknown, where: string): Settings {
    if (!isPlainObject(given)) {
      const defaults = this.parse({}, where)
      const problem = `${where} isn't a JSON object of settings, so it was ignored`
      return { ...defaults, problems: [problem, ...defaults.problems] }
    }
    const json: Readonly<Record<string, unknown>> = given
    const known = new Set(this.#decls.map((decl) => decl.name))
    const unknown = Object.keys(json)
      .filter((name) => !known.has(name))
      .map((name) => `${where} sets ${name}, which this mod has no setting for`)
    const entries = this.#decls.map((decl) => parseEntry({ decl, given: json[decl.name], where }))
    const problems = [...unknown, ...entries.flatMap((one) => one.problem)]
    const missing = entries
      .filter((one) => one.value === undefined && one.decl.isRequired)
      .map(
        (one) =>
          `this mod needs ${one.decl.name} set in ${where}, as ${expectedTypeText(one.decl)}`,
      )
    if (missing.length > 0) return { isOk: false, problems: [...problems, ...missing] }
    const options = Object.fromEntries(
      entries.flatMap((one) => (one.value === undefined ? [] : [[one.decl.name, one.value]])),
    )
    return { isOk: true, options, problems }
  }

  /** Read a JSON settings file from `path` (treating a missing file as `{}`) and validate it. */
  loadFile(path: string): Settings {
    return this.parse(readJsonFile(path), path)
  }
}
