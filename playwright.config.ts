import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './apps/studio/e2e',
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

	// The app only allows a single instance to be running at a time, so we can
	// only run one test at a time.
	workers: 1,

	// Retry flaky tests once to improve CI reliability
	retries: 1,

	// 'list' prints every test start/finish with duration as it happens; the CI
	// default 'dot' prints one character per test and holds all detail until the
	// end of the run, which is useless when a job hangs or gets canceled mid-run.
	reporter: 'list',

	use: {
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
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
