import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'scripts',
			include: [ '**/*.{test,spec}.ts' ],
			environment: 'node',
		},
	} )
);
