import path from 'path';
import { defineConfig } from '@playwright/test';
import baseConfig from '../playwright.config';

process.env.ARTIFACTS_PATH ??= path.join( __dirname, 'artifacts' );

export default defineConfig( {
	...baseConfig,
	testDir: './tests',
	testMatch: '*.test.ts',
	reporter: [ [ 'list' ], [ './performance-reporter.ts' ] ],
	outputDir: path.join( process.env.ARTIFACTS_PATH, 'test-results' ),
	forbidOnly: !! process.env.CI,
	fullyParallel: false,
	retries: 2, // Retry flaky tests up to 2 times
	timeout: parseInt( process.env.TIMEOUT || '', 10 ) || 600_000, // Defaults to 10 minutes.
	reportSlowTests: null,
	use: {
		...baseConfig.use,
		actionTimeout: 240_000, // 4 minutes.
		headless: true,
		// Enable only for debugging.
		trace: 'off',
		screenshot: 'off',
		video: 'off',
	},
	expect: {
		timeout: 240_000, // 4 minutes.
	},
} );
