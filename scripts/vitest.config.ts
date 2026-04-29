import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'scripts',
			include: [ '**/__tests__/**/*.test.ts' ],
			environment: 'node',
		},
	} )
);
