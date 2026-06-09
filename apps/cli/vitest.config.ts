import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		define: {
			__IS_PACKAGED_FOR_NPM__: true,
		},
		test: {
			name: 'cli',
			include: [ '**/*.test.{ts,tsx}' ],
			setupFiles: [ path.resolve( __dirname, './vitest.setup.ts' ) ],
			pool: 'forks',
		},
		resolve: {
			alias: {
				cli: path.resolve( __dirname, '.' ),
				'@studio/common': path.resolve( __dirname, '../../tools/common' ),
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
