import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'cli',
			include: [ '**/*.test.{ts,tsx}' ],
			setupFiles: [ path.resolve( __dirname, './vitest.setup.ts' ) ],
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
