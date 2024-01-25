import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './e2e',
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
} );
