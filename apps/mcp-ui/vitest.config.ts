import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		test: { name: 'mcp-ui', include: [ 'src/**/*.test.{ts,tsx}' ] },
		resolve: { alias: { '@': path.resolve( import.meta.dirname, 'src' ) } },
	} )
);
