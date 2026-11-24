import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

const __dirname = import.meta.dirname;

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: {
			name: 'ds',
			include: [ '**/*.test.{ts,tsx}' ],
			setupFiles: [ path.resolve( __dirname, './vitest.setup.ts' ) ],
		},
	} )
);
