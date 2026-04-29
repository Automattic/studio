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
			lib: {
				entry: {
					'eval-runner': resolve( __dirname, 'ai/eval-runner.ts' ),
				},
			},
		},
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
		},
	} )
);
