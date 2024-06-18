import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './e2e',
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

	// The app only allows a single instance to be running at a time, so we can
	// only run one test at a time.
	workers: 1,

	use: {
		trace: 'retain-on-failure',
	},

	timeout: 60_000,
} );
