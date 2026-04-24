import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

// Copies the locally-downloaded PHP binary into the dist output after each dev build.
// Silently skips when the binary hasn't been downloaded yet.
// Run `npm run download:php-binary` to fetch it.
function copyPhpBinaryPlugin(): Plugin {
	const phpBinName = process.platform === 'win32' ? 'php.exe' : 'php';
	const src = resolve( __dirname, 'bin', phpBinName );
	const dest = resolve( __dirname, 'dist', 'cli', 'bin', phpBinName );
	return {
		name: 'copy-php-binary-for-dev',
		closeBundle() {
			if ( ! existsSync( src ) ) return;
			mkdirSync( dirname( dest ), { recursive: true } );
			copyFileSync( src, dest );
		},
	};
}

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
				],
			} ),
			copyPhpBinaryPlugin(),
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
