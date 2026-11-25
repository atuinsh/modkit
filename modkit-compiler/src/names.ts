/**
 * Normalization of npm package names into harness plugin identifiers.
 *
 * @module
 */

import slugify from '@sindresorhus/slugify'

// Maximum plugin name length enforced by Claude Code and kept consistent across targets.
const NAME_LENGTH = 64

/**
 * Convert a package `name` into a harness plugin identifier.
 *
 * Strips any `@scope/` prefix, slugifies to lowercase ASCII with `-` separators, and truncates to
 * 64 characters (for example, `@me/Branch Status` -> `branch-status`).
 */
export function pluginNameOf(name: string): string {
  const bare = name.replace(/^@[^/]+\//u, '')
  return slugify(bare, { decamelize: false }).slice(0, NAME_LENGTH)
}
