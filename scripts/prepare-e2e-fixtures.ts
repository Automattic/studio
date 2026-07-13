#!/usr/bin/env tsx
/**
 * Download the data-heavy e2e fixtures declared in test-fixtures/manifest.json
 * into test-fixtures/downloads/ (files that already verify are skipped).
 *
 * Usage:
 *   npm run e2e:fixtures                 # warn on download failures (tests skip)
 *   npm run e2e:fixtures -- --require    # fail on any missing fixture (CI)
 *
 * Also runs automatically before the Playwright e2e suite via
 * apps/studio/e2e/global-setup.ts. See test-fixtures/readme.md for how the
 * fixtures are hosted and how to add one.
 */
import path from 'path';
import { prepareE2eFixtures } from '@studio/common/lib/prepare-e2e-fixtures';

const isRequired = process.env.CI === 'true' || process.argv.includes( '--require' );

void main();

async function main(): Promise< void > {
	try {
		await prepareE2eFixtures( {
			require: isRequired,
			rootDir: path.resolve( import.meta.dirname, '..' ),
		} );
	} catch ( error ) {
		console.error( ( error as Error ).message );
		process.exitCode = 1;
	}
}
