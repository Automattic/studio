import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { STUDIO_SITES_ROOT as mockSitesRoot } from 'cli/lib/site-paths';
import { getSiteRootForFile, isWpLspAvailable } from '../pool';

vi.mock( 'cli/lib/site-paths', async () => {
	const { mkdtempSync } = await import( 'fs' );
	const { tmpdir } = await import( 'os' );
	const { join } = await import( 'path' );
	return { STUDIO_SITES_ROOT: mkdtempSync( join( tmpdir(), 'studio-lsp-pool-' ) ) };
} );

describe( 'getSiteRootForFile', () => {
	beforeAll( () => {
		fs.mkdirSync( path.join( mockSitesRoot, 'my-site', 'wp-content' ), { recursive: true } );
	} );

	afterAll( () => {
		fs.rmSync( mockSitesRoot, { recursive: true, force: true } );
	} );

	it( 'maps a file inside a site to the site root', () => {
		expect(
			getSiteRootForFile( path.join( mockSitesRoot, 'my-site', 'wp-content', 'x.php' ) )
		).toBe( path.join( mockSitesRoot, 'my-site' ) );
	} );

	it( 'returns null for the sites root itself', () => {
		expect( getSiteRootForFile( mockSitesRoot ) ).toBeNull();
	} );

	it( 'returns null for files outside the sites root', () => {
		expect( getSiteRootForFile( path.join( os.tmpdir(), 'elsewhere.php' ) ) ).toBeNull();
	} );

	it( 'returns null when the site folder does not exist', () => {
		expect( getSiteRootForFile( path.join( mockSitesRoot, 'ghost-site', 'file.php' ) ) ).toBeNull();
	} );
} );

describe( 'isWpLspAvailable', () => {
	afterEach( () => {
		delete process.env.STUDIO_WP_LSP_PATH;
	} );

	it( 'is false when the override points at a directory without bin/wp-lsp', () => {
		const empty = fs.mkdtempSync( path.join( os.tmpdir(), 'wp-lsp-empty-' ) );
		process.env.STUDIO_WP_LSP_PATH = empty;
		expect( isWpLspAvailable() ).toBe( false );
		fs.rmSync( empty, { recursive: true, force: true } );
	} );

	it( 'is true when the override contains bin/wp-lsp', () => {
		const root = fs.mkdtempSync( path.join( os.tmpdir(), 'wp-lsp-real-' ) );
		fs.mkdirSync( path.join( root, 'bin' ) );
		fs.writeFileSync( path.join( root, 'bin', 'wp-lsp' ), '<?php // stub' );
		process.env.STUDIO_WP_LSP_PATH = root;
		expect( isWpLspAvailable() ).toBe( true );
		fs.rmSync( root, { recursive: true, force: true } );
	} );
} );
