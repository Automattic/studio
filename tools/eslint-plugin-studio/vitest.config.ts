import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'eslint-plugin-studio',
			include: [ 'tests/**/*.test.{ts,tsx}' ],
		},
	} )
);
