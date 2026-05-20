import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

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
				'@studio/common': path.resolve( __dirname, '../../tools/common' ),
			},
		},
	} )
);
