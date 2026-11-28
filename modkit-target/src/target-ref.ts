import { Result } from './host/result.ts'

const BARE_TARGET = /^[a-z][a-z0-9-]*$/u
const SCOPED_TARGET = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/u

/** A target entry listed in `modkit.targets`, mapping to its npm package name. */
export class TargetRef {
  readonly #name: string
  readonly #packageName: string

  private constructor(name: string, packageName: string) {
    this.#name = name
    this.#packageName = packageName
  }

  /** Parse a bare target name (`codex`) or scoped package name (`@acme/modkit-custom`). */
  static parse(raw: string): Result<TargetRef, string> {
    if (raw === 'targets') return Result.err('`targets` names the list, not a target')
    if (BARE_TARGET.test(raw)) return Result.ok(new TargetRef(raw, `@atuin/modkit-${raw}`))
    if (SCOPED_TARGET.test(raw)) return Result.ok(new TargetRef(raw, raw))
    return Result.err('a target name is lowercase letters, digits and -, or a scoped package name')
  }

  /** The target name as listed in `modkit.targets`. */
  get name(): string {
    return this.#name
  }

  /** The npm package exporting `./codegen` for this target. */
  get packageName(): string {
    return this.#packageName
  }
}
