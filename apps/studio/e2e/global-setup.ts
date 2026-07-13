/**
 * Playwright global setup: fetch the data-heavy import fixtures declared in
 * test-fixtures/manifest.json before the suite runs. Locally a failed download
 * only warns (the affected tests skip themselves); in CI it fails the run so
 * fixture problems surface here rather than as silently skipped tests.
 */
import path from 'path';
import { prepareE2eFixtures } from '@studio/common/lib/prepare-e2e-fixtures';

export default async function globalSetup(): Promise< void > {
	await prepareE2eFixtures( {
		require: process.env.CI === 'true',
		rootDir: path.resolve( __dirname, '..', '..', '..' ),
	} );
}
