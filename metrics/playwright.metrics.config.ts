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
	retries: 0,
	timeout: parseInt( process.env.TIMEOUT || '', 10 ) || 600_000, // Defaults to 10 minutes.
	reportSlowTests: null,
	use: {
		...baseConfig.use,
		actionTimeout: 120_000, // 2 minutes.
		headless: true,
		// Enable only for debugging.
		trace: 'off',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	expect: {
		timeout: 300_000, // 5 minutes.
	},
} );
