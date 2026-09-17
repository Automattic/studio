import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'design-md',
			include: [ '**/*.test.ts' ],
		},
	} )
);
