import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSitePreviewPath, readSitePreview, writeSitePreview } from '../site-preview-cache';

const dirs = vi.hoisted( () => ( { config: '' } ) );
vi.mock( '../well-known-paths', () => ( { getConfigDirectory: () => dirs.config } ) );

describe( 'site preview cache', () => {
	beforeEach( () => {
		dirs.config = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-previews-' ) );
	} );
	afterEach( () => fs.rmSync( dirs.config, { recursive: true, force: true } ) );

	it( 'stores a capture per site and reads it back as a data URL', async () => {
		await writeSitePreview( '../site-1', Buffer.from( 'png-bytes' ) );

		expect( await readSitePreview( '../site-1' ) ).toBe(
			`data:image/png;base64,${ Buffer.from( 'png-bytes' ).toString( 'base64' ) }`
		);
		expect( await readSitePreview( 'site-2' ) ).toBeNull();
		expect( fs.readdirSync( path.join( dirs.config, 'previews' ) ) ).toEqual( [
			expect.stringMatching( /^[0-9a-f]{64}\.png$/ ),
		] );
	} );

	it( 'falls back to an older capture', async () => {
		const legacy = path.join( dirs.config, 'legacy.png' );
		fs.writeFileSync( legacy, 'old' );

		expect( await readSitePreview( 'site-1', legacy ) ).toBe( 'data:image/png;base64,b2xk' );
	} );

	it( 'skips admin and sign-in pages', () => {
		expect( isSitePreviewPath( '/' ) ).toBe( true );
		expect( isSitePreviewPath( '/about/' ) ).toBe( true );
		expect( isSitePreviewPath( '/wp-admin/' ) ).toBe( false );
		expect( isSitePreviewPath( '/wp-login.php?redirect=1' ) ).toBe( false );
		expect( isSitePreviewPath( '/studio-auto-login?redirect_to=/' ) ).toBe( false );
	} );
} );
