import { existsSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const dlaPath = resolve( __dirname, 'ai/dla' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			viteStaticCopy( {
				targets: [
					{
						src: 'ai/plugin',
						dest: '.',
					},
					// Conditionally include the vendored Data Liberation Agent tree.
					// `ai/dla` is fetched at install time via `scripts/download-data-liberation-agent.ts`
					// and may be absent for contributors without access to the private repo;
					// guard with `existsSync` so the build still succeeds in that case.
					...( existsSync( dlaPath )
						? [
								{
									src: 'ai/dla',
									dest: '.',
								},
						  ]
						: [] ),
				],
			} ),
		],
		build: {
			sourcemap: false,
			rollupOptions: {
				output: {
					// Add shebang to main.mjs so it can be executed directly as a CLI.
					banner: ( chunk ) => ( chunk.fileName === 'main.mjs' ? '#!/usr/bin/env node' : '' ),
				},
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
