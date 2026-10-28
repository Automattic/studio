import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'agent',
			include: [ '**/*.{test,spec}.{ts,tsx}' ],
			// The pi packages load native addons that crash Node on Windows when a
			// worker thread exits (see the CLI project's config).
			pool: 'forks',
		},
		resolve: {
			alias: {
				'@studio/agent': path.resolve( __dirname, '.' ),
				'@studio/common': path.resolve( __dirname, '../common' ),
				'@studio/design-md': path.resolve( __dirname, '../design-md/index.ts' ),
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
