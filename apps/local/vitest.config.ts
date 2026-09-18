import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'local',
			include: [ '**/*.test.{ts,tsx}' ],
			pool: 'forks',
		},
		resolve: {
			alias: {
				'@studio/common': path.resolve( __dirname, '../../packages/common' ),
			},
		},
	} )
);
