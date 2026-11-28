import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { genImport, genObjectFromValues } from 'knitwork'
import { build, type ExternalOption } from 'rolldown'

import {
  ImageBundle,
  type ArtifactWriter,
  type ImageDecl,
  type OptionDecl,
  type SourceEmitter,
  type StateDecl,
  type VirtualModule,
} from '@atuin/modkit-target'

import type { SettingDecl } from '../runtime/settings.ts'
import type { Tags } from '../runtime/store.ts'

const ENTRY = '\0modkit-entry'

type SerializablePayload<Fn> = Fn extends (served: infer Served) => unknown
  ? Omit<Served, 'mod' | 'images'>
  : never

/** Options for {@link NodeBundler.emitEntry}, binding codegen output to a runtime entry function. */
export interface RuntimeEntryOptions<Fn> {
  readonly file: string
  readonly runtimeUrl: URL
  readonly exportName: string
  readonly mode: 'default-export' | 'top-level-await'
  readonly mod: string
  readonly images: readonly ImageDecl[]
  readonly payload: SerializablePayload<Fn>
  readonly external?: ExternalOption
}

/** Bound Rolldown bundler and metadata translator for Node/Bun target codegen. */
export class NodeBundler {
  readonly #dir: string
  readonly #emit: ArtifactWriter

  private constructor({ dir, emit }: { dir: string; emit: ArtifactWriter }) {
    this.#dir = dir
    this.#emit = emit
  }

  /** Create a bundler bound to a mod's directory `dir` and target `emit` writer. */
  static for({ dir, emit }: { dir: string; emit: ArtifactWriter }): NodeBundler {
    return new NodeBundler({ dir, emit })
  }

  /** Map compiler {@link StateDecl}s into the schema-tag table read by `FileStore`. */
  static stateTags(state: readonly StateDecl[]): Tags {
    return Object.fromEntries(state.map((one) => [one.id, one.tag]))
  }

  /** Convert a compiler {@link OptionDecl} into a runtime {@link SettingDecl}. */
  static settingDecl(option: OptionDecl): SettingDecl {
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

  /** Bundle a virtual entry {@link SourceEmitter} (plus optional {@link VirtualModule}s) into `file`. */
  bundle({
    entry,
    modules = [],
    file,
    platform = 'node',
    external,
  }: {
    entry: string | SourceEmitter
    modules?: readonly VirtualModule[]
    file: string
    platform?: 'node' | 'neutral'
    external?: ExternalOption
  }): void {
    const dir = this.#dir
    const entryEmitter: SourceEmitter =
      typeof entry === 'string' ? { emitSource: () => entry } : entry
    const byId = new Map<string, SourceEmitter>([
      [ENTRY, entryEmitter],
      ...modules.map((mod): readonly [string, SourceEmitter] => [mod.id, mod]),
    ])
    this.#emit.write(async (out) => {
      await build({
        input: ENTRY,
        cwd: dir,
        platform,
        ...(external !== undefined && { external }),
        plugins: [
          {
            name: 'modkit-entry',
            resolveId: (id) => (byId.has(id) ? id : null),
            load: (id) => byId.get(id)?.emitSource() ?? null,
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
        output: { file: join(out, file), format: 'es', codeSplitting: false },
      })
    })
  }

  /**
   * Emit a bundled runtime entry module verified at compile time against `Fn`'s parameter shape
   * (`Omit<Served, 'mod' | 'images'>`).
   */
  emitEntry<Fn>(options: RuntimeEntryOptions<Fn>): void {
    const { file, runtimeUrl, exportName, mode, mod, images, payload, external } = options
    const runtimePath = fileURLToPath(runtimeUrl)
    const entry: SourceEmitter = {
      emitSource: () => {
        const call = `${exportName}({ mod, images: ${new ImageBundle(images).emitSource()}, ...${genObjectFromValues(payload)} })`
        const invocation = mode === 'top-level-await' ? `await ${call}` : `export default ${call}`
        return [
          genImport(runtimePath, [exportName]),
          genImport(mod, 'mod'),
          '',
          invocation,
          '',
        ].join('\n')
      },
    }
    this.bundle({ file, entry, ...(external !== undefined && { external }) })
  }
}
