import path from 'path';
import { defineProject, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

export default mergeConfig(
	sharedConfig,
	defineProject( {
		define: {
			__IS_PACKAGED_FOR_NPM__: true,
		},
		test: {
			name: 'cli',
			include: [ '**/*.test.{ts,tsx}' ],
			setupFiles: [ path.resolve( __dirname, './vitest.setup.ts' ) ],
			// Run CLI tests in child processes instead of worker threads. The AI
			// runtime tests import the real `@earendil-works/pi-coding-agent`,
			// which transitively loads native `.node` addons (pi-tui, clipboard).
			// Native addons crashing on worker-thread teardown segfault the whole
			// runner process — an intermittent failure seen on Windows CI under the
			// shared `pool: 'threads'`. Forks isolate each file in its own process
			// so a native teardown crash can't take down the runner. See AINFRA-2475.
			pool: 'forks',
		},
		resolve: {
			alias: {
				cli: path.resolve( __dirname, '.' ),
				'@studio/common': path.resolve( __dirname, '../../tools/common' ),
				'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
	} )
);
