/**
 * The start of a harness's dekit task, which turns into the harness itself once the build it
 * would start on checks out.
 *
 * @module
 */

import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { DevCommand, Env } from '@atuin/modkit-target'

import type { Build } from './build.ts'
import { clock, digestOf } from './landed.ts'
import { DevLayout } from './layout.ts'

// Where `program` is on `env`'s `PATH`, if it is.
function pathTo({ program, env }: { program: string; env: Env }): string | undefined {
  return (env['PATH'] ?? '')
    .split(delimiter)
    .map((dir) => join(dir, program))
    .find((path) => {
      try {
        accessSync(path, constants.X_OK)
        return true
      } catch {
        return false
      }
    })
}

// The command that starts the target `name`'s harness on the build last landed for it, or why it
// doesn't start.
async function commandOf({
  build,
  name,
  env,
}: {
  build: Build
  name: string
  env: Env
}): Promise<DevCommand | string> {
  const place = DevLayout.for(build).target(name)
  const landed = await place.landed()
  if (landed === undefined) return `${name} starts once a build of it lands`
  const listed = await build.listed()
  const target = listed?.find((one) => one.name === name)
  if (target === undefined) return `modkit.targets no longer lists ${name}, so it gets no harness`
  const out = join(build.out, name)
  const { plugin, hasStatus } = landed
  const harness = target.dev({ out, plugin, hasStatus, scratch: place.scratch, env })
  const digest = await digestOf({ dir: out, skipped: harness.writes })
  if (digest !== landed.digest) {
    return `${name}: not started, since a build that never landed wrote over the ${clock(landed.at)} one; the next build that does starts it`
  }
  return harness.command({ id: landed.session })
}

/**
 * Replace this process with the harness of the target `name`, on the build the `modkit-logs` task
 * last landed for it; returns an exit code only when it doesn't start.
 *
 * The build is checked once, so a save landing between the check and the harness reading its
 * files can still start it on a mix: dekit's restart key is pressed by hand, which makes that
 * window rare, and the build that lands restarts the harness onto itself.
 */
export async function launch({
  build,
  name,
  env,
}: {
  build: Build
  name: string
  env: Env
}): Promise<number> {
  const command = await commandOf({ build, name, env })
  if (typeof command === 'string') {
    console.error(command)
    return 1
  }
  const program = pathTo({ program: command.program, env })
  if (program === undefined) {
    console.error(`${command.program} is not on PATH, so ${name} gets no harness`)
    return 1
  }
  if (process.execve === undefined) {
    console.error(
      `${name}: modkit dev starts a harness in place of its own process, which ${process.platform} can't do`,
    )
    return 1
  }
  return process.execve(program, [command.program, ...command.args], { ...env, ...command.env })
}
