import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		define: {
			__IS_PACKAGED_FOR_NPM__: true,
			__IS_PACKAGED_FOR_STANDALONE__: false,
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
				'@studio/common': path.resolve( __dirname, '../../packages/common' ),
				'@studio/agent': path.resolve( __dirname, '../../packages/agent' ),
				'@studio/design-md': path.resolve( __dirname, '../../packages/design-md/index.ts' ),
				'@studio/local': path.resolve( __dirname, '../local/src' ),
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
