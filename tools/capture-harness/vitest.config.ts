import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'capture-harness',
			include: [ '**/*.test.ts' ],
			environment: 'node',
		},
	} )
);
