import { resolve } from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { existsSync } from 'fs';

const yargsLocalesPath = resolve(__dirname, 'node_modules/yargs/locales');

export default defineConfig({
	plugins: [
		...(existsSync(yargsLocalesPath) ? [
			viteStaticCopy({
				targets: [
					{
						src: yargsLocalesPath,
						dest: '../locales' // Relative to outDir (dist/cli), so this goes to dist/locales
					}
				]
			})
		] : [])
	],
	build: {
		lib: {
			entry: resolve(__dirname, 'cli/index.ts'),
			name: 'StudioCLI',
			fileName: 'main',
			formats: ['cjs']
		},
		outDir: 'dist/cli',
		target: 'node18',
		rollupOptions: {
			external: [
				// Keep these as external dependencies
				'yargs',
				'@wordpress/i18n',
				// Node.js built-ins - use node: prefix pattern
				/^node:/,
				// Regular Node.js built-ins
				/^(path|fs|os|child_process|crypto|http|https|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants)$/
			],
			output: {
				// Ensure commonjs format for Node.js compatibility
				format: 'cjs',
				entryFileNames: 'main.js'
			}
		},
		sourcemap: true,
		minify: false // Keep readable for debugging
	},
	resolve: {
		alias: {
			cli: resolve(__dirname, 'cli'),
			src: resolve(__dirname, 'src'),
			vendor: resolve(__dirname, 'vendor'),
			common: resolve(__dirname, 'common')
		}
	}
});