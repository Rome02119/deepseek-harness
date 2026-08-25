import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/demo.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
  sourcemap: false,
})
