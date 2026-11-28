import { mod } from '@atuin/modkit'

const FORCE_PUSH = /\bgit\s+push\b.*\s(?:--force(?:-with-lease)?|-f)\b/u

export default mod(() => ({
  beforeShell: (call) =>
    FORCE_PUSH.test(call.command)
      ? { ask: `This force-pushes from ${call.cwd}.`, otherwise: 'deny' }
      : undefined,
}))
