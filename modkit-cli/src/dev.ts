/**
 * The `dev` command, which runs a mod's harnesses in dekit: a task per target the mod lists, each
 * running its harness on the target's build, beside a `modkit-logs` task that builds on every save.
 *
 * Run by hand, it opens the {@link DevProject} in this terminal. Its tasks run it again, saying
 * which task they are in their environment ({@link TaskEnv}): `modkit-logs` runs the
 * {@link Workspace}, and a harness's task turns into its harness ({@link HarnessTask.exec}).
 *
 * @module
 */

import type { Env } from '@atuin/modkit-target'

import { Build } from './build.ts'
import { HarnessTask } from './harness-task.ts'
import { DevLayout } from './layout.ts'
import { DevProject, type DevArgs } from './project.ts'
import { TaskEnv } from './task-env.ts'
import { Workspace } from './workspace.ts'

const WITHOUT_HARNESSES = 'run modkit build --watch to rebuild on save without them'

// Opens the mod's project in this terminal, returning the exit code once it quits or detaches.
async function opened({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `modkit dev runs the harnesses in dekit, which needs a terminal; ${WITHOUT_HARNESSES}`,
    )
    return 1
  }
  const project = await DevProject.for({ args, env })
  if (project.outcome.isOk) return project.outcome.value.open()
  console.error(project.outcome.error)
  return 1
}

/** Run the `dev` command, returning its exit code once it returns at all. */
export async function dev({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  const read = TaskEnv.read(env)
  if (!read.outcome.isOk) {
    console.error(read.outcome.error)
    return 1
  }
  const { role, started } = read.outcome.value
  if (role === undefined) return opened({ args, env })
  const build = Build.of(args)
  const layout = DevLayout.for(build)
  switch (role.kind) {
    case 'harness':
      return HarnessTask.in({ layout, name: role.target, env: started }).exec(build)
    case 'logs':
      break
  }
  const workspace = await Workspace.for({ build, layout, env: started })
  if (!workspace.outcome.isOk) {
    console.error(workspace.outcome.error)
    return 1
  }
  await workspace.outcome.value.run()
  return 0
}
