import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    cwd: 'packages/modkit',
    entry: {
      index: 'src/index.ts',
      'ui/hooks': 'src/ui/hooks/index.ts',
      'jsx-runtime': 'src/jsx-runtime.ts',
    },
    platform: 'neutral',
    dts: true,
  },
  {
    cwd: 'packages/compiler',
    entry: {
      index: 'src/index.ts',
    },
    dts: true,
  },
  {
    cwd: 'packages/targets/claude',
    entry: { 'codegen/index': 'src/codegen/index.ts' },
    tsconfig: 'src/codegen/tsconfig.json',
    dts: true,
  },
  {
    cwd: 'packages/targets/claude',
    entry: { 'runtime/index': 'src/runtime/index.ts' },
    tsconfig: 'src/runtime/tsconfig.json',
    platform: 'neutral',
    deps: { neverBundle: ['claude-code', 'modkit-claude:state', 'modkit-claude:env'] },
    dts: true,
  },
  {
    cwd: 'packages/cli',
    entry: { main: 'src/main.ts' },
  },
])
