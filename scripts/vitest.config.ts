import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'scripts',
			environment: 'node',
			include: [ '**/*.test.ts' ],
		},
	} )
);
