/**
 * Generator for the virtual `modkit-claude:env` module.
 *
 * `claude plugin validate` requires every environment variable read via `$.env.get(...)` to appear
 * as a string literal in the bundle. This generator emits a `switch` over the compiler-collected
 * variable names so each read uses a literal call.
 *
 * @module
 */

import { genString } from 'knitwork'

/** Generate the virtual `modkit-claude:env` module exporting `readEnv($, name)` for `names`. */
export function envSource(names: readonly string[]): string {
  return [
    'export function readEnv($, name) {',
    '  switch (name) {',
    ...names.map(
      (name) => `    case ${genString(name)}:\n      return $.env.get(${genString(name)})`,
    ),
    '  }',
    '  return Promise.reject(',
    // oxlint-disable-next-line eslint/no-template-curly-in-string -- emitted source, interpolated where it runs
    "    new Error(`the mod reads ${name} through no harness.env('${name}') the compiler could see, and Claude Code lets a mod read only the variables it names`),",
    '  )',
    '}',
    '',
  ].join('\n')
}
