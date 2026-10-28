import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'studio',
			environment: 'node',
			include: [ 'src/**/*.test.{ts,tsx}' ],
			setupFiles: [ path.resolve( __dirname, './vitest.setup.ts' ) ],
			env: {
				// Prevents electron/index.js from trying to download the Electron binary
				// when path.txt is absent (e.g. in CI where only the npm package is installed).
				ELECTRON_OVERRIDE_DIST_PATH: '/dev/null',
			},
		},
		resolve: {
			alias: {
				src: path.resolve( __dirname, './src' ),
				'@studio/common': path.resolve( __dirname, '../../packages/common' ),
				'@studio/agent': path.resolve( __dirname, '../../packages/agent' ),
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
