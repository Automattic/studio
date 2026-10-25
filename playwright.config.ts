import { defineConfig } from '@playwright/test';

export default defineConfig( {
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

	projects: [
		{ name: 'studio', testDir: './apps/studio/e2e' },
		// Critical flows in the agentic UI: the packaged Desktop app, and `studio ui`
		// in a browser (tests with "browser" in their title).
		{ name: 'ui-desktop', testDir: './apps/ui/e2e', grepInvert: /browser/ },
		{ name: 'ui-web', testDir: './apps/ui/e2e', grep: /browser/ },
	],

	// Downloads the data-heavy import fixtures declared in
	// test-fixtures/manifest.json before the suite runs.
	globalSetup: './apps/studio/e2e/global-setup.ts',

	// Each E2ESession isolates the app's single-instance lock, data, daemon and
	// site ports, so files run concurrently. Tests within a file stay serial.
	workers: 2,

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
