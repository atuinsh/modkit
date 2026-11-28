import { readFileSync } from 'node:fs'

import * as v from 'valibot'

import { isPlainRecord, type Options } from '@atuin/modkit-target/host'

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

function schemaForDecl(decl: SettingDecl): v.GenericSchema<unknown, OptionValue> {
  switch (decl.kind) {
    case 'string':
      return decl.choices === undefined ? v.string() : v.picklist(decl.choices)
    case 'strings':
      return v.array(v.string())
    case 'number':
      return v.pipe(v.number(), v.finite())
    case 'boolean':
      break
  }
  return v.boolean()
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (Error.isError(error) && 'code' in error && error.code === 'ENOENT') return {}
    return undefined
  }
}

interface CompiledDecl {
  readonly decl: SettingDecl
  readonly schema: v.GenericSchema<unknown, OptionValue>
}

interface ParsedEntry {
  decl: SettingDecl
  value: OptionValue | undefined
  problem: string[]
}

function parseEntry({
  compiled: { decl, schema },
  given,
  where,
}: {
  compiled: CompiledDecl
  given: unknown
  where: string
}): ParsedEntry {
  const parsed = given === undefined ? undefined : v.safeParse(schema, given)
  const value = parsed?.success === true ? parsed.output : undefined
  const problem =
    given !== undefined && value === undefined
      ? [
          `${where} sets ${decl.name} to ${JSON.stringify(given)}, but it takes ${expectedTypeText(decl)}`,
        ]
      : []
  return { decl, value: value ?? decl.default, problem }
}

/** Validating schema for a mod's user settings, compiled to Valibot once from {@link SettingDecl}s. */
export class SettingsSchema {
  readonly #compiled: readonly CompiledDecl[]
  readonly #known: ReadonlySet<string>

  private constructor(decls: readonly SettingDecl[]) {
    this.#compiled = decls.map((decl) => ({ decl, schema: schemaForDecl(decl) }))
    this.#known = new Set(decls.map((decl) => decl.name))
  }

  /** Construct a schema from compiler-emitted {@link SettingDecl} entries. */
  static from(decls: readonly SettingDecl[]): SettingsSchema {
    return new SettingsSchema(decls)
  }

  /** Parse and validate `given` against this schema, anchoring problems to `where`. */
  parse(given: unknown, where: string): Settings {
    if (!isPlainRecord(given)) {
      const defaults = this.parse({}, where)
      const problem = `${where} isn't a JSON object of settings, so it was ignored`
      return { ...defaults, problems: [problem, ...defaults.problems] }
    }
    const unknown = new Set(Object.keys(given))
      .difference(this.#known)
      .values()
      .map((name) => `${where} sets ${name}, which this mod has no setting for`)
      .toArray()
    const entries = this.#compiled.map((compiled) =>
      parseEntry({ compiled, given: given[compiled.decl.name], where }),
    )
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
