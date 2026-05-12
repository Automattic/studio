import { defineConfig } from '@playwright/test';

// Linux CI runs without a GPU and falls back to SwiftShader software
// rendering on CPU, so every interaction (clicks, state-driven enables,
// route transitions) takes measurably longer than on Mac/Windows native
// agents with hardware acceleration. Bump the default action/expect/test
// timeouts on Linux only — leaves Mac and Windows runs unaffected.
const isLinux = process.platform === 'linux';

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
		actionTimeout: isLinux ? 60_000 : 30_000,
	},

	timeout: isLinux ? 240_000 : 180_000,

	// Global expect timeout for all assertions
	// Note: Some tests override this with longer timeouts for slow operations like site creation
	expect: {
		timeout: isLinux ? 60_000 : 30_000,
	},
} );
