import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'common',
			include: [ '**/*.{test,spec}.{ts,tsx}' ],
		},
		resolve: {
			alias: {
				'@studio/common': path.resolve( __dirname, '.' ),
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
