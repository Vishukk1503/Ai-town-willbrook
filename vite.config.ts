import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const pixiRequire = createRequire(require.resolve('pixi.js'));
const pixiDependencies = Object.keys(JSON.parse(readFileSync(resolve(dirname(require.resolve('pixi.js')), '../package.json'), 'utf8')).dependencies);

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ai-town',
  define: { 'process.env': '{}' },
  plugins: [react()],
  resolve: {
    alias: Object.fromEntries(pixiDependencies.map((name) => [name, pixiRequire.resolve(name).replace(/\.js$/, '.mjs')])),
    dedupe: ['pixi.js', ...pixiDependencies],
  },
  server: {
    allowedHosts: ['ai-town-your-app-name.fly.dev', 'localhost', '127.0.0.1'],
  },
});
