import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readConfig } from '../config/store';
import { getOrCreateAnalyticsInstallId } from '../install';

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-install-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'mints the analytics install id once, even for concurrent callers', async () => {
	const ids = await Promise.all( [
		getOrCreateAnalyticsInstallId(),
		getOrCreateAnalyticsInstallId(),
	] );

	expect( ids[ 0 ] ).toBeTruthy();
	expect( ids[ 1 ] ).toBe( ids[ 0 ] );
	expect( ( await readConfig() ).install.analyticsId ).toBe( ids[ 0 ] );
	expect( await getOrCreateAnalyticsInstallId() ).toBe( ids[ 0 ] );
} );
