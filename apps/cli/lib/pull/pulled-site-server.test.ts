import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodePassword } from '@studio/common/lib/passwords';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPulledSiteStartOptions, reapplyAdminCredentials } from './pulled-site-server';
import type { SiteData } from 'cli/lib/cli-config/core';

describe( 'reapplyAdminCredentials', () => {
	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	function makeSite( overrides: Record< string, unknown > = {} ) {
		return {
			id: 'site-1',
			name: 'Test Site',
			path: '/tmp/test-site',
			port: 8901,
			phpVersion: '8.2',
			running: true,
			...overrides,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	}

	it( 'skips when the site record has no admin credentials', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal( 'fetch', fetchSpy );

		await expect( reapplyAdminCredentials( makeSite() ) ).resolves.toBe( 'skipped' );
		expect( fetchSpy ).not.toHaveBeenCalled();
	} );

	it( 'posts the stored credentials to the running site admin API', async () => {
		const fetchSpy = vi.fn().mockResolvedValue( { ok: true, status: 200 } );
		vi.stubGlobal( 'fetch', fetchSpy );

		const site = makeSite( { adminPassword: encodePassword( 'secret-pw' ) } );
		await expect( reapplyAdminCredentials( site ) ).resolves.toBe( 'applied' );

		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = fetchSpy.mock.calls[ 0 ];
		expect( String( url ) ).toContain( 'studio-admin-api' );
		expect( init.method ).toBe( 'POST' );
		const params = init.body as URLSearchParams;
		expect( params.get( 'action' ) ).toBe( 'set_admin_password' );
		expect( params.get( 'password' ) ).toBe( 'secret-pw' );
	} );

	it( 'reports an unreachable server instead of throwing on connection failure', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'ECONNREFUSED' ) ) );

		const site = makeSite( { adminPassword: encodePassword( 'secret-pw' ) } );
		await expect( reapplyAdminCredentials( site ) ).resolves.toBe( 'unreachable' );
	} );

	it( 'throws when the admin API answers with an error status', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 400 } ) );

		const site = makeSite( { adminPassword: encodePassword( 'secret-pw' ) } );
		await expect( reapplyAdminCredentials( site ) ).rejects.toThrow(
			'Failed to re-apply the admin credentials'
		);
	} );
} );

describe( 'getPulledSiteStartOptions', () => {
	const makeSite = ( overrides: Partial< SiteData > = {} ): SiteData => ( {
		id: 'test-id',
		name: 'Test Site',
		path: '/tmp/test-site',
		port: 8881,
		phpVersion: '8.4',
		...overrides,
	} );

	it( 'returns runtime.php as the prepend file for a pulled site that has it', () => {
		const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-' ) );
		const runtimeDir = path.join( importRoot, 'runtime' );
		const runtimeBlueprintPath = path.join( runtimeDir, 'blueprint.json' );
		const runtimePhpPath = path.join( runtimeDir, 'runtime.php' );

		try {
			fs.mkdirSync( runtimeDir, { recursive: true } );
			fs.writeFileSync( runtimeBlueprintPath, '{}' );
			fs.writeFileSync( runtimePhpPath, '<?php' );

			expect(
				getPulledSiteStartOptions(
					makeSite( { runtimeBlueprintPath, technicalSiteDirectory: importRoot } )
				)
			).toEqual( {
				autoPrependFile: runtimePhpPath,
				openBasedirAllowList: [ importRoot ],
			} );
		} finally {
			fs.rmSync( importRoot, { recursive: true, force: true } );
		}
	} );

	it( 'returns undefined for a normal site without runtimeBlueprintPath', () => {
		expect( getPulledSiteStartOptions( makeSite() ) ).toBeUndefined();
	} );

	it( 'returns undefined (does not throw) when runtime.php is missing', () => {
		const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-missing-' ) );
		const runtimeBlueprintPath = path.join( importRoot, 'runtime', 'blueprint.json' );

		try {
			fs.mkdirSync( path.dirname( runtimeBlueprintPath ), { recursive: true } );
			fs.writeFileSync( runtimeBlueprintPath, '{}' );
			// Intentionally no runtime.php written.
			expect( getPulledSiteStartOptions( makeSite( { runtimeBlueprintPath } ) ) ).toBeUndefined();
		} finally {
			fs.rmSync( importRoot, { recursive: true, force: true } );
		}
	} );
} );
