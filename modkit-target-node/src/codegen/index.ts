import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'
import { build, type ExternalOption } from 'rolldown'

import {
  imagesSource,
  type ArtifactWriter,
  type ImageDecl,
  type OptionDecl,
  type StateDecl,
} from '@atuin/modkit-target'

import type { SettingDecl } from '../runtime/settings.ts'
import type { Tags } from '../runtime/store.ts'

export const stateTags = (state: readonly StateDecl[]): Tags =>
  Object.fromEntries(state.map((one) => [one.id, one.tag]))

export function settingDecl(option: OptionDecl): SettingDecl {
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

type SerializablePayload<Fn> = Fn extends (served: infer Served) => unknown
  ? Omit<Served, 'mod' | 'images'>
  : never

/** Options for {@link emitRuntimeEntry}, binding codegen output to a runtime entry function's signature. */
export interface RuntimeEntryOptions<Fn> {
  readonly file: string
  readonly dir: string
  readonly runtimeUrl: URL
  readonly exportName: string
  readonly mode: 'default-export' | 'top-level-await'
  readonly mod: string
  readonly images: readonly ImageDecl[]
  readonly payload: SerializablePayload<Fn>
  readonly external?: ExternalOption
}

/**
 * Emit a bundled runtime entry module verified at compile time against `Fn`'s parameter shape
 * (`Omit<Served, 'mod' | 'images'>`).
 */
export function emitRuntimeEntry<Fn>(emit: ArtifactWriter, options: RuntimeEntryOptions<Fn>): void {
  const { file, dir, runtimeUrl, exportName, mode, mod, images, payload, external } = options
  const runtimePath = fileURLToPath(runtimeUrl)
  const call = `${exportName}({ mod, images: ${imagesSource(images)}, ...${genObjectFromValues(payload)} })`
  const invocation = mode === 'top-level-await' ? `await ${call}` : `export default ${call}`
  const entry = [
    genImport(runtimePath, [exportName]),
    genImport(mod, 'mod'),
    '',
    invocation,
    '',
  ].join('\n')
  emit.write(async (out) =>
    bundle({ dir, entry, file: join(out, file), ...(external !== undefined && { external }) }),
  )
}
