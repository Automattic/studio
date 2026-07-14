import path from 'path';
import { defineConfig } from '@playwright/test';
import baseConfig from '../../playwright.config';

process.env.ARTIFACTS_PATH ??= path.join( __dirname, 'artifacts' );

export default defineConfig( {
	...baseConfig,
	// The perf suite has its own tests and doesn't need the e2e data-heavy
	// fixtures, so drop the base config's fixture-download globalSetup — its
	// repo-root-relative path wouldn't resolve from this config's directory.
	globalSetup: undefined,
	testDir: './tests',
	testMatch: '*.test.ts',
	reporter: [ [ 'list' ], [ './performance-reporter.ts' ] ],
	outputDir: path.join( process.env.ARTIFACTS_PATH, 'test-results' ),
	forbidOnly: !! process.env.CI,
	fullyParallel: false,
	retries: 1, // Retry flaky tests once (reduced from 2 to surface issues faster)
	timeout: parseInt( process.env.TIMEOUT || '', 10 ) || 180_000, // Defaults to 3 minutes.
	reportSlowTests: null,
	use: {
		...baseConfig.use,
		actionTimeout: 60_000, // 1 minute.
		headless: true,
		// Enable only for debugging.
		trace: 'off',
		screenshot: 'off',
		video: 'off',
	},
	expect: {
		timeout: 40_000, // 40 seconds.
	},
} );
