import { defineConfig } from '@playwright/test';

// TEMP(rsm-2593): Linux CI has no GPU and rasterizes via SwiftShader on CPU,
// so every interaction takes measurably longer than on Mac/Windows native.
// Previously tried `actionTimeout: isLinux ? 60_000 : 30_000` but build 16042
// still reported "Timeout 30000ms exceeded", which means either the conditional
// evaluated wrong or the config wasn't loaded — diagnostic below will tell us.
// Restore the platform-conditional values before re-enabling Mac/Windows E2E.
//
// eslint-disable-next-line no-console -- diagnostic during Linux E2E bring-up
console.log(
	`[playwright.config] process.platform=${ process.platform } actionTimeout=60000 testTimeout=240000`
);

export default defineConfig( {
	testDir: './apps/studio/e2e',
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

	// The app only allows a single instance to be running at a time, so we can
	// only run one test at a time.
	workers: 1,

	// Retry flaky tests once to improve CI reliability
	retries: 1,

	use: {
		trace: 'retain-on-failure',
		// Action timeout for clicks, fills, etc. (prevents hanging on blocked elements)
		actionTimeout: 60_000,
	},

	timeout: 240_000,

	// Global expect timeout for all assertions
	// Note: Some tests override this with longer timeouts for slow operations like site creation
	expect: {
		timeout: 60_000,
	},
} );
