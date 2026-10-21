import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './apps/studio/e2e',
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

	// Downloads the data-heavy import fixtures declared in
	// test-fixtures/manifest.json before the suite runs.
	globalSetup: './apps/studio/e2e/global-setup.ts',

	// The app only allows a single instance to be running at a time, so we can
	// only run one test at a time.
	workers: 1,

	// Retry flaky tests once to improve CI reliability
	retries: 1,

	use: {
		trace: 'retain-on-failure',
		// Action timeout for clicks, fills, etc. (prevents hanging on blocked elements)
		actionTimeout: 30_000,
	},

	timeout: 180_000,

	// Global expect timeout for all assertions
	// Note: Some tests override this with longer timeouts for slow operations like site creation
	expect: {
		timeout: 30_000,
	},
} );
