import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './e2e',
	workers: 1,
	timeout: 180_000,
	expect: { timeout: 30_000 },
	use: { actionTimeout: 30_000, trace: 'retain-on-failure' },
} );
