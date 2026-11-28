import { resolve } from 'node:path'

import { declarationsIn } from './declarations.ts'
import { DiagnosticError } from './diagnostics.ts'
import { ModAst } from './entry.ts'
import { hostImportsIn } from './imports.ts'
import type { Compiled, HookNeeds, ModInfo, StateDecl } from './ir.ts'
import { literalsIn, type Literals } from './literals.ts'
import { ModManifest } from './manifest.ts'
import { modpartsIn, type Modparts } from './modparts.ts'
import { optionsIn } from './options.ts'
import { TsProject } from './program.ts'

// TypeScript's own errors, which stop the build before modkit reads an ill-typed program.
function typeErrorsIn(project: TsProject): DiagnosticError[] {
  const broken = project.projectErrors().map(({ fileName, text }) =>
    DiagnosticError.atFile({
      code: 'project',
      message: text,
      file: fileName ?? project.tsconfig,
    }),
  )
  if (broken.length > 0) return broken
  return project.files.flatMap((file) =>
    project.fileErrors(file).map((error) => DiagnosticError.fromTypeScript({ error, file })),
  )
}

function capture<T>(fn: () => T, diagnostics: DiagnosticError[]): T | undefined {
  try {
    return fn()
  } catch (error) {
    if (error instanceof DiagnosticError) {
      diagnostics.push(error)
      return undefined
    }
    throw error
  }
}

const SHELL_TOOL = 'Bash'

function hooksFor({
  modparts,
  tools,
  state,
}: {
  modparts: Modparts
  tools: Literals['tools']
  state: readonly StateDecl[]
}): HookNeeds {
  const needsAfterShell =
    modparts.afterShell !== undefined || state.some((entry) => entry.kind === 'query')
  return {
    before: modparts.beforeShell === undefined ? tools.before : [SHELL_TOOL, ...tools.before],
    after: needsAfterShell ? [SHELL_TOOL, ...tools.after] : tools.after,
    cards: tools.cards,
    hasStatus: modparts.status !== undefined,
    hasPanes: modparts.panes !== undefined || modparts.commands !== undefined,
  }
}

/** Compiler bound to a mod directory producing target-independent {@link Compiled} IR. */
export class ModCompiler {
  readonly #dir: string
  readonly #targetPackages: readonly string[]

  constructor({ dir, targetPackages = [] }: { dir: string; targetPackages?: readonly string[] }) {
    this.#dir = dir
    this.#targetPackages = targetPackages
  }

  /** Compile the bound mod directory into target-independent {@link Compiled} IR. */
  compile(): Compiled {
    const manifest = new ModManifest(this.#dir)
    const initial: DiagnosticError[] = []
    const mod = capture(() => manifest.readInfo(), initial)
    const tsconfig = capture(() => manifest.resolveTsconfig(), initial)
    if (tsconfig === undefined) return { isOk: false, diagnostics: initial }
    using project = TsProject.open(tsconfig)
    return this.#compileProject({ project, mod, initial })
  }

  #compileProject({
    project,
    mod,
    initial,
  }: {
    project: TsProject
    mod: ModInfo | undefined
    initial: readonly DiagnosticError[]
  }): Compiled {
    const typeErrors = typeErrorsIn(project)
    const path = resolve(this.#dir, 'mod.tsx')
    const entry = project.files.find((file) => resolve(file.fileName) === path)
    if (mod === undefined || typeErrors.length > 0 || entry === undefined) {
      const missing =
        entry === undefined
          ? [
              DiagnosticError.atFile({
                code: 'no-mod',
                message: "a mod's entry is mod.tsx, beside its package.json",
                file: path,
              }),
            ]
          : []
      return { isOk: false, diagnostics: [...initial, ...typeErrors, ...missing] }
    }
    const astErrors: DiagnosticError[] = []
    const ast = capture(() => ModAst.from({ project, entry }), astErrors)
    if (ast === undefined) return { isOk: false, diagnostics: astErrors }
    return this.#assemble({ project, mod, path, ast })
  }

  #assemble({
    project,
    mod,
    path,
    ast,
  }: {
    project: TsProject
    mod: ModInfo
    path: string
    ast: ModAst
  }): Compiled {
    const declared = declarationsIn(project)
    const settings = optionsIn({ project, mod: ast })
    const literals = literalsIn({ project, mod: ast, dir: this.#dir })
    const diagnostics = [
      ...hostImportsIn(project, this.#targetPackages),
      ...declared.diagnostics,
      ...settings.diagnostics,
      ...literals.diagnostics,
    ]
    if (diagnostics.length > 0) return { isOk: false, diagnostics }
    const modparts = modpartsIn(ast)
    return {
      isOk: true,
      mod,
      entry: path,
      state: declared.state,
      options: settings.options,
      env: literals.env,
      tools: literals.tools,
      images: literals.images,
      modparts,
      hooks: hooksFor({ modparts, tools: literals.tools, state: declared.state }),
    }
  }
}
