import { resolve } from 'node:path'

import { declarationsIn } from './declarations.ts'
import { fromTypeScript, type Diagnostic } from './diagnostics.ts'
import { modCallIn } from './entry.ts'
import type { Compiled } from './ir.ts'
import { literalsIn } from './literals.ts'
import { modInfo, tsconfigAt } from './manifest.ts'
import { modpartsIn } from './modparts.ts'
import { optionsIn } from './options.ts'
import { errorsIn, openProject, projectErrorsIn, type Project } from './program.ts'

// TypeScript's own errors, which stop the build before modkit reads an ill-typed program.
function typeErrorsIn(project: Project): Diagnostic[] {
  const broken = projectErrorsIn(project).map(({ fileName, text }) => ({
    code: 'project' as const,
    message: text,
    file: fileName ?? project.tsconfig,
    line: 1,
    column: 1,
  }))
  if (broken.length > 0) return broken
  return project.files.flatMap((file) =>
    errorsIn({ project, file }).map((error) => fromTypeScript({ error, file })),
  )
}

const isDiagnostic = (value: object): value is Diagnostic => 'code' in value

function compiledIn({ project, dir }: { project: Project; dir: string }): Compiled {
  const mod = modInfo(dir)
  const typeErrors = typeErrorsIn(project)
  const path = resolve(dir, 'mod.tsx')
  const entry = project.files.find((file) => resolve(file.fileName) === path)
  if (isDiagnostic(mod) || typeErrors.length > 0 || entry === undefined) {
    const message = "a mod's entry is mod.tsx, beside its package.json"
    const missing: Diagnostic[] =
      entry === undefined ? [{ code: 'no-mod', message, file: path, line: 1, column: 1 }] : []
    return {
      isOk: false,
      diagnostics: [...(isDiagnostic(mod) ? [mod] : []), ...typeErrors, ...missing],
    }
  }
  const call = modCallIn({ project, entry })
  if (isDiagnostic(call)) return { isOk: false, diagnostics: [call] }
  const declared = declarationsIn(project)
  const settings = optionsIn({ project, mod: call })
  const literals = literalsIn({ project, mod: call })
  const diagnostics = [...declared.diagnostics, ...settings.diagnostics, ...literals.diagnostics]
  if (diagnostics.length > 0) return { isOk: false, diagnostics }
  return {
    isOk: true,
    mod,
    entry: path,
    state: declared.state,
    options: settings.options,
    env: literals.env,
    tools: literals.tools,
    modparts: modpartsIn(call),
  }
}

export function compile({ dir }: { dir: string }): Compiled {
  const tsconfig = tsconfigAt(dir)
  if (typeof tsconfig !== 'string') {
    const mod = modInfo(dir)
    return { isOk: false, diagnostics: isDiagnostic(mod) ? [mod, tsconfig] : [tsconfig] }
  }
  const project = openProject({ tsconfig })
  try {
    return compiledIn({ project, dir })
  } finally {
    project.close()
  }
}
