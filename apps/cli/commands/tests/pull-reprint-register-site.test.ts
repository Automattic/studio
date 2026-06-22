import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { registerSite } from '../pull-reprint';

vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		readCliConfig: vi.fn(),
		saveCliConfig: vi.fn(),
		lockCliConfig: vi.fn(),
		unlockCliConfig: vi.fn(),
	};
} );

describe( 'CLI: studio pull-reprint registerSite', () => {
	let technicalSiteDirectory: string;

	beforeEach( () => {
		vi.clearAllMocks();
		technicalSiteDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-register-site-' ) );
		// No existing site, so registerSite takes the "create a new record" path.
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
		} );
		vi.mocked( saveCliConfig ).mockResolvedValue( undefined );
		vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		fs.rmSync( technicalSiteDirectory, { recursive: true, force: true } );
	} );

	function buildMetadata() {
		return {
			version: 1,
			pullKey: 'pull-key',
			normalizedUrl: 'https://example.wpcomstaging.com/',
			siteName: 'example.wpcomstaging.com',
			sitePath: path.join( technicalSiteDirectory, 'site' ),
			technicalSiteDirectory,
			rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
			stateDirectory: path.join( technicalSiteDirectory, 'state' ),
			runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
			runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
			stage: 'site-registered',
			// Pre-set so ensurePort short-circuits without reaching the port finder.
			port: 8881,
			localUrl: 'http://localhost:8881',
			remoteSiteUrl: 'https://example.wpcomstaging.com',
		} as never;
	}

	it( 'registers a freshly pulled site on the Playground runtime', async () => {
		const { created, site } = await registerSite( buildMetadata() );

		expect( created ).toBe( true );
		// Reprint-pulled sites are laid out for the Playground runtime: VFS
		// mounts place wp-content — and its SQLite db.php drop-in — under
		// /wordpress/wp-content. Falling back to the default native-php
		// runtime resolves WP_CONTENT_DIR to the WordPress core path, the
		// drop-in never loads, and WordPress dies with "Error establishing a
		// database connection" on start.
		expect( site.runtime ).toBe( SITE_RUNTIME_PLAYGROUND );

		// The persisted record (not just the returned object) carries it too.
		expect( saveCliConfig ).toHaveBeenCalledTimes( 1 );
		const persisted = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
		expect( persisted.sites ).toHaveLength( 1 );
		expect( persisted.sites[ 0 ].runtime ).toBe( SITE_RUNTIME_PLAYGROUND );
	} );
} );
