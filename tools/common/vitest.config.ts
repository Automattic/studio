import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

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
			},
		},
	} )
);
