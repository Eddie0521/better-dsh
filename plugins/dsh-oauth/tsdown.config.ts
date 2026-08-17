import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: false,
  clean: true,
  target: 'node22',
  platform: 'node',
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  deps: {
    neverBundle: [
      'cordis',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-commands',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/schemastery',
      '@earendil-works/pi-ai',
      'node:crypto',
      'node:http',
      'node:net',
      'node:child_process',
    ],
  },
})
