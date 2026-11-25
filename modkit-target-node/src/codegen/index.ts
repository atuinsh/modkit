import { build, type ExternalOption } from 'rolldown'

import type { OptionDecl } from '@atuin/modkit-target'

import type { SettingDecl } from '../runtime/settings.ts'

export function missingToolNotes({
  tools,
  harness,
  has,
}: {
  tools: { before: readonly string[]; after: readonly string[]; cards?: readonly string[] }
  harness: string
  has: ReadonlySet<string>
}): string[] {
  const hooked = new Set([...tools.before, ...tools.after, ...(tools.cards ?? [])])
  return [...hooked]
    .filter((tool) => !has.has(tool) && !tool.startsWith('mcp__'))
    .toSorted()
    .map((tool) => `${harness} has no ${tool} tool, so what the mod does on it never runs there`)
}

export function settingOf(option: OptionDecl): SettingDecl {
  const common = { name: option.name, isRequired: option.isRequired }
  switch (option.kind) {
    case 'string':
      return {
        ...common,
        kind: 'string',
        ...(option.choices !== undefined && { choices: option.choices }),
        ...(option.default !== undefined && { default: option.default }),
      }
    case 'strings':
      return {
        ...common,
        kind: 'strings',
        ...(option.default !== undefined && { default: option.default }),
      }
    case 'number':
      return {
        ...common,
        kind: 'number',
        ...(option.default !== undefined && { default: option.default }),
      }
    case 'boolean':
      break
  }
  return {
    ...common,
    kind: 'boolean',
    ...(option.default !== undefined && { default: option.default }),
  }
}

const ENTRY = '\0modkit-entry'

export async function bundle({
  dir,
  entry,
  file,
  platform = 'node',
  external,
}: {
  dir: string
  entry: string
  file: string
  platform?: 'node' | 'neutral'
  external?: ExternalOption
}): Promise<void> {
  await build({
    input: ENTRY,
    cwd: dir,
    platform,
    ...(external !== undefined && { external }),
    plugins: [
      {
        name: 'modkit-entry',
        resolveId: (id) => (id === ENTRY ? id : null),
        load: (id) => (id === ENTRY ? entry : null),
      },
    ],
    transform: { jsx: { runtime: 'automatic', importSource: '@atuin/modkit' } },
    // A mod's JSX is modkit's whatever its tsconfig says, so the override Rolldown warns of is meant.
    // oxlint-disable-next-line eslint/max-params -- Rolldown's signature
    onLog: (level, log, handler) => {
      if (
        log.code === 'CONFIGURATION_FIELD_CONFLICT' &&
        /jsxImportSource|compilerOptions\.jsx\b/u.test(log.message)
      ) {
        return
      }
      handler(level, log)
    },
    write: true,
    output: { file, format: 'es', codeSplitting: false },
  })
}
