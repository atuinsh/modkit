/**
 * The environment of a process `modkit dev` runs as one of its dekit tasks, which says the task
 * in `MODKIT_DEV` and `MODKIT_DEV_TARGET` over the environment `modkit dev` was started in.
 *
 * @module
 */

import * as v from 'valibot'

import { Result, type Env } from '@atuin/modkit-target'

/** Which of `modkit dev`'s dekit tasks a process runs as. */
export type TaskRole =
  /** The `modkit-logs` task, which builds on every save and lands each build. */
  | { readonly kind: 'logs' }
  /** A task running the harness of `target`. */
  | { readonly kind: 'harness'; readonly target: string }

const RoleVars = v.variant('MODKIT_DEV', [
  v.object({ MODKIT_DEV: v.literal('logs') }),
  v.object({ MODKIT_DEV: v.literal('harness'), MODKIT_DEV_TARGET: v.string() }),
])

/** What says a process's {@link TaskRole}, and the environment the harnesses get. */
export class TaskEnv {
  /** The task the process runs as, or none when it was run by hand. */
  readonly role: TaskRole | undefined
  /** The environment `modkit dev` was started in: this one, but for what says the task. */
  readonly started: Env

  private constructor({ role, started }: { role: TaskRole | undefined; started: Env }) {
    this.role = role
    this.started = started
  }

  /** The task environment `env` is, or why it isn't one `modkit dev` set. */
  static read(env: Env): Result<TaskEnv, string> {
    const { MODKIT_DEV, MODKIT_DEV_TARGET, ...started } = env
    if (MODKIT_DEV === undefined) return Result.ok(new TaskEnv({ role: undefined, started }))
    const vars = v.safeParse(RoleVars, { MODKIT_DEV, MODKIT_DEV_TARGET })
    if (!vars.success) {
      return Result.err(
        `MODKIT_DEV is ${MODKIT_DEV}, which only modkit dev's own tasks set (logs, or harness with MODKIT_DEV_TARGET)`,
      )
    }
    const role: TaskRole =
      vars.output.MODKIT_DEV === 'logs'
        ? { kind: 'logs' }
        : { kind: 'harness', target: vars.output.MODKIT_DEV_TARGET }
    return Result.ok(new TaskEnv({ role, started }))
  }

  /** The variables that say `role` to its task's process, which {@link TaskEnv.read} reads. */
  static varsFor(role: TaskRole): Readonly<Record<string, string>> {
    switch (role.kind) {
      case 'harness':
        return { MODKIT_DEV: 'harness', MODKIT_DEV_TARGET: role.target }
      case 'logs':
        break
    }
    return { MODKIT_DEV: 'logs' }
  }
}
