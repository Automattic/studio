import path from 'path';
import { defineConfig } from '@playwright/test';
import baseConfig from '../playwright.config';

process.env.ARTIFACTS_PATH ??= path.join( process.cwd(), 'artifacts' );

export default defineConfig( {
	...baseConfig,
	testDir: './tests',
	testMatch: /.*\.test\.ts/,
	reporter: process.env.CI
		? './performance-reporter.ts'
		: [ [ 'list' ], [ './performance-reporter.ts' ] ],
} );
