/**
 * Playwright global setup: fetch the data-heavy import fixtures declared in
 * test-fixtures/manifest.json before the suite runs. Locally a failed download
 * only warns (the affected tests skip themselves); in CI it fails the run so
 * fixture problems surface here rather than as silently skipped tests.
 */
import { prepareE2eFixtures } from '@studio/common/lib/prepare-e2e-fixtures';
import { REPO_ROOT } from './constants';

export default async function globalSetup(): Promise< void > {
	await prepareE2eFixtures( {
		require: process.env.CI === 'true',
		rootDir: REPO_ROOT,
	} );
}
