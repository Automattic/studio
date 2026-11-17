import { existsSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig, buildLocalUiPlugin, buildMcpUiPlugin } from './vite.config.base.ts';

const __dirname = import.meta.dirname;

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			buildLocalUiPlugin(),
			buildMcpUiPlugin(),
			...( existsSync( cliNodeModulesPath )
				? [
						viteStaticCopy( {
							targets: [
								{
									// The CLI runs without its dependencies' source maps and type declarations.
									src: [ 'node_modules', '!node_modules/**/*.{map,d.ts,d.mts,d.cts}' ],
									dest: '.',
								},
							],
						} ),
				  ]
				: [] ),
		],
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
		},
	} )
);
