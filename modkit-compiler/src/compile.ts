import { resolve } from 'node:path'

import { declarationsIn } from './declarations.ts'
import { ModDiagnostic, type Diagnostic } from './diagnostics.ts'
import { ModAst } from './entry.ts'
import { hostImportsIn } from './imports.ts'
import type { Compiled, HookNeeds, ModInfo, StateDecl } from './ir.ts'
import { literalsIn, type Literals } from './literals.ts'
import { ModManifest } from './manifest.ts'
import { modpartsIn, type Modparts } from './modparts.ts'
import { optionsIn } from './options.ts'
import { TsProject, type SourceFile } from './program.ts'

// TypeScript's own errors, which stop the build before modkit reads an ill-typed program.
function typeErrorsIn(project: TsProject): Diagnostic[] {
  const broken = project
    .projectErrors()
    .map(({ fileName, text }) =>
      ModDiagnostic.atFile({ code: 'project', message: text, file: fileName ?? project.tsconfig }),
    )
  if (broken.length > 0) return broken
  return project.files.flatMap((file) =>
    project.fileErrors(file).map((error) => ModDiagnostic.fromTypeScript({ error, file })),
  )
}

const isDiagnostic = (value: object): value is Diagnostic => 'code' in value

// The manifest, TypeScript or a missing entry, any of which keeps modkit from reading the mod.
function unreadable({
  mod,
  typeErrors,
  entry,
  path,
}: {
  mod: ModInfo | Diagnostic
  typeErrors: readonly Diagnostic[]
  entry: SourceFile | undefined
  path: string
}): Compiled {
  const message = "a mod's entry is mod.tsx, beside its package.json"
  const missing: Diagnostic[] =
    entry === undefined ? [ModDiagnostic.atFile({ code: 'no-mod', message, file: path })] : []
  return {
    isOk: false,
    diagnostics: [...(isDiagnostic(mod) ? [mod] : []), ...typeErrors, ...missing],
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
    const tsconfig = manifest.resolveTsconfig()
    if (typeof tsconfig !== 'string') {
      const mod = manifest.readInfo()
      return { isOk: false, diagnostics: isDiagnostic(mod) ? [mod, tsconfig] : [tsconfig] }
    }
    using project = TsProject.open(tsconfig)
    return this.#compileProject(project, manifest)
  }

  #compileProject(project: TsProject, manifest: ModManifest): Compiled {
    const mod = manifest.readInfo()
    const typeErrors = typeErrorsIn(project)
    const path = resolve(this.#dir, 'mod.tsx')
    const entry = project.files.find((file) => resolve(file.fileName) === path)
    if (isDiagnostic(mod) || typeErrors.length > 0 || entry === undefined) {
      return unreadable({ mod, typeErrors, entry, path })
    }
    const ast = ModAst.from({ project, entry })
    if (isDiagnostic(ast)) return { isOk: false, diagnostics: [ast] }
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
