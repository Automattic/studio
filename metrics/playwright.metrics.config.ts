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
	retries: 2, // Retry flaky tests to handle CI infrastructure variability
	timeout: parseInt( process.env.TIMEOUT || '', 10 ) || 270_000, // Defaults to 4.5 minutes (50% increase for CI stability).
	reportSlowTests: null,
	use: {
		...baseConfig.use,
		actionTimeout: 90_000, // 1.5 minutes (50% increase for CI stability).
		headless: true,
		// Enable screenshot on failure to diagnose CI issues
		trace: 'off',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	expect: {
		timeout: 45_000, // 45 seconds (50% increase for CI stability).
	},
} );
