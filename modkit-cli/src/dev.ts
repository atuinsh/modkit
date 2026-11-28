/**
 * The `dev` command, which runs a mod's harnesses in dekit: a task per target the mod lists, each
 * running its harness on the target's build, beside a `modkit-logs` task that builds on every save.
 *
 * Run by hand, it writes the dekit project into `<out>/.dev/<mod>` and attaches this terminal to
 * it. Its tasks run it again with `MODKIT_DEV` set: `watch` for the `modkit-logs` task
 * ({@link Workspace}), and `harness` for a harness's, with `MODKIT_DEV_TARGET` naming the target
 * ({@link launch}).
 *
 * @module
 */

import { resolve } from 'node:path'

import * as v from 'valibot'

import type { Env } from '@atuin/modkit-target'

import { Build } from './build.ts'
import { Dekit, type DekitTask } from './dekit.ts'
import { launch } from './launch.ts'
import { DevLayout } from './layout.ts'
import { Workspace } from './workspace.ts'

/** What the `dev` command is run with. */
export interface DevArgs {
  dir: string | undefined
  out: string | undefined
  cwd: string | undefined
  only: string | undefined
}

const WITHOUT_HARNESSES = 'run modkit build --watch to rebuild on save without them'

// The path of the `modkit-logs` task, which no target's task can take: a bare target's name holds
// no `.`, and a scoped one's slug ({@link TargetPlace.slug}) starts with `_40`.
const LOGS_PATH = 'modkit.logs'

// The targets `--only` names, or every one the mod lists; why not, when it names one it doesn't.
function pickedOf({
  only,
  listed,
}: {
  only: string | undefined
  listed: readonly string[]
}): readonly string[] | string {
  if (only === undefined) return listed
  const names = only
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  const unlisted = names.filter((name) => !listed.includes(name))
  if (unlisted.length === 0) return names
  return `--only names ${unlisted.join(', ')}, which modkit.targets does not list (it lists ${listed.join(', ')})`
}

// The tasks of the dekit project: a harness's per target in `names`, then `modkit-logs`. Each runs
// this command again as it was run, under tsx or not, with every argument resolved.
function tasksOf({
  build,
  layout,
  cwd,
  names,
}: {
  build: Build
  layout: DevLayout
  cwd: string
  names: readonly string[]
}): DekitTask[] {
  // This process's script, `src/main.ts`, after the runtime and its flags.
  const [, script] = process.argv
  const self = [process.execPath, ...process.execArgv, ...(script === undefined ? [] : [script])]
  const args = ['dev', build.dir, '--out', build.out, '--cwd', cwd, '--only', names.join(',')]
  const cmd = [...self, ...args]
  const watch: DekitTask = {
    path: LOGS_PATH,
    label: 'modkit-logs',
    cmd,
    cwd: process.cwd(),
    env: { MODKIT_DEV: 'watch' },
    autostart: true,
  }
  const harnesses = names.map((name) => ({
    path: layout.target(name).slug,
    label: name,
    cmd,
    cwd,
    env: { MODKIT_DEV: 'harness', MODKIT_DEV_TARGET: name },
    autostart: false,
  }))
  // The sidebar lists the tasks in this order: the harnesses first, and the build log last.
  return [...harnesses, watch]
}

// Writes the project for a runner to start on: no record of a build any harness landed, and no
// tasks a quit kept.
async function written({
  layout,
  dekit,
  config,
  names,
}: {
  layout: DevLayout
  dekit: Dekit
  config: string
  names: readonly string[]
}): Promise<void> {
  await dekit.configure(config)
  await layout.reset(names)
  await dekit.forgetSaved()
}

// The targets that get a harness, which the mod's package.json lists and `--only` picks; none when
// it can't be read or `--only` names one it doesn't, saying why.
async function namesOf({
  build,
  only,
}: {
  build: Build
  only: string | undefined
}): Promise<readonly string[] | undefined> {
  const listed = await build.listed()
  if (listed === undefined) return undefined
  const names = pickedOf({ only, listed: listed.map((target) => target.name) })
  if (typeof names === 'string') {
    console.error(names)
    return undefined
  }
  return names
}

const RunningConfig = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({ tasks: v.object({ [LOGS_PATH]: v.object({ cmd: v.array(v.string()) }) }) }),
)

// The flags the `modkit-logs` task of the `dekit.yaml` `config` runs with, after the mod's
// directory, if it reads as one this command wrote.
function flagsOf(config: string): string | undefined {
  const parsed = v.safeParse(RunningConfig, config)
  if (!parsed.success) return undefined
  const { cmd } = parsed.output.tasks[LOGS_PATH]
  const [, ...flags] = cmd.slice(cmd.indexOf('dev') + 1)
  return flags.join(' ')
}

// Readies the project to attach to: written for a runner to start on, or, when one runs, written
// as this run would write it; false when it runs with other arguments, saying so.
async function readied({
  layout,
  dekit,
  config,
  names,
  dir,
}: {
  layout: DevLayout
  dekit: Dekit
  config: string
  names: readonly string[]
  dir: string
}): Promise<boolean> {
  await layout.make()
  if (!(await dekit.isRunning())) {
    await written({ layout, dekit, config, names })
    return true
  }
  // Attaching to the one running would leave this run's arguments unused.
  const running = await dekit.config()
  if (running === config) return true
  const flags =
    (running === undefined ? undefined : flagsOf(running)) ?? '<the arguments it runs with>'
  console.error(
    `modkit dev already runs ${dir} with ${flags}; modkit dev ${dir} ${flags} gets back to it, and q there quits it`,
  )
  return false
}

// Attaches to `dekit` until it quits or is detached from, returning the exit code: non-zero when
// the quit left something to undo, which the `modkit-logs` task reported.
async function attached({ layout, dekit }: { layout: DevLayout; dekit: Dekit }): Promise<number> {
  const code = await dekit.attach()
  if (await dekit.isRunning()) {
    console.log(
      'modkit dev runs on in the background; modkit dev with the same arguments gets back to it',
    )
    return code
  }
  const unclosed = await layout.takeReport()
  if (unclosed === undefined) return code
  process.stderr.write(unclosed)
  return 1
}

// Opens the dekit project for the mod in this terminal, returning the exit code once it quits or
// is detached from.
async function opened({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `modkit dev runs the harnesses in dekit, which needs a terminal; ${WITHOUT_HARNESSES}`,
    )
    return 1
  }
  const build = Build.of(args)
  const names = await namesOf({ build, only: args.only })
  if (names === undefined) return 1
  const layout = DevLayout.for(build)
  const dekit = new Dekit({ root: layout.root, env })
  const config = Dekit.configOf(tasksOf({ build, layout, cwd: resolve(args.cwd ?? '.'), names }))
  if (!(await readied({ layout, dekit, config, names, dir: build.dir }))) return 1
  return attached({ layout, dekit })
}

/** Run the `dev` command, returning its exit code once it returns at all. */
export async function dev({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  // The harnesses get the environment `modkit dev` was started in, which is this one but for these.
  const { MODKIT_DEV: mode, MODKIT_DEV_TARGET: target, ...started } = env
  if (mode === undefined) return opened({ args, env })
  const build = Build.of(args)
  if (mode === 'harness' && target !== undefined) {
    return launch({ build, name: target, env: started })
  }
  if (mode !== 'watch') {
    console.error(
      `MODKIT_DEV is ${mode}, which only modkit dev's own tasks set (watch, or harness with MODKIT_DEV_TARGET)`,
    )
    return 1
  }
  const names = (args.only ?? '').split(',').filter((name) => name !== '')
  const layout = DevLayout.for(build)
  const dekit = new Dekit({ root: layout.root, env: started })
  await new Workspace({ build, layout, dekit, names, env: started }).run()
  return 0
}
