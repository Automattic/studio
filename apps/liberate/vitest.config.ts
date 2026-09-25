import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'liberate',
			include: [ 'src/**/*.test.ts' ],
			environment: 'node',
			pool: 'forks',
		},
	} )
);
