import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'ui',
			include: [ 'src/**/*.test.{ts,tsx}' ],
			setupFiles: [ path.resolve( __dirname, './vitest.setup.ts' ) ],
		},
		resolve: {
			alias: {
				'@': path.resolve( __dirname, 'src' ),
				'@studio/common': path.resolve( __dirname, '../../packages/common' ),
				// See `vite.config.ts` for why this subpath needs an explicit alias.
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
