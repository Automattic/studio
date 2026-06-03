import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReprintPharPath } from '../paths';
import { ensureReprintPharAvailable, updateLatestReprintPhar } from '../reprint';

vi.mock( '../paths', () => ( { getReprintPharPath: vi.fn() } ) );
vi.mock( '@studio/common/lib/download-file', () => ( { downloadFile: vi.fn() } ) );
vi.mock( '@studio/common/lib/lockfile', () => ( {
	lockFileAsync: vi.fn().mockResolvedValue( undefined ),
	unlockFileAsync: vi.fn().mockResolvedValue( undefined ),
} ) );

let cacheDir: string;
let pharPath: string;
let versionPath: string;

function mockLatestRelease( tag: string, asset = 'reprint.phar' ): void {
	vi.mocked( global.fetch ).mockResolvedValue( {
		ok: true,
		json: async () => ( {
			tag_name: tag,
			assets: [ { name: asset, browser_download_url: `https://example.test/${ asset }` } ],
		} ),
	} as Response );
}

describe( 'reprint dependency', () => {
	beforeEach( () => {
		cacheDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-' ) );
		pharPath = path.join( cacheDir, 'reprint.phar' );
		versionPath = path.join( cacheDir, 'version.json' );
		vi.mocked( getReprintPharPath ).mockReturnValue( pharPath );
		// downloadFile writes the (fake) phar to the temp path it is given, mirroring a real download.
		vi.mocked( downloadFile ).mockImplementation( async ( _url, dest ) => {
			fs.writeFileSync( dest, 'PHAR' );
		} );
		vi.stubGlobal( 'fetch', vi.fn() );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		fs.rmSync( cacheDir, { recursive: true, force: true } );
	} );

	describe( 'updateLatestReprintPhar', () => {
		it( 'downloads the phar and records the release tag when nothing is installed', async () => {
			mockLatestRelease( 'v1.2.3' );

			await updateLatestReprintPhar();

			expect( downloadFile ).toHaveBeenCalledTimes( 1 );
			expect( fs.existsSync( pharPath ) ).toBe( true );
			expect( JSON.parse( fs.readFileSync( versionPath, 'utf8' ) ) ).toEqual( { tag: 'v1.2.3' } );
		} );

		it( 'skips the download when the installed tag matches the latest release', async () => {
			fs.writeFileSync( pharPath, 'PHAR' );
			fs.writeFileSync( versionPath, JSON.stringify( { tag: 'v1.2.3' } ) );
			mockLatestRelease( 'v1.2.3' );

			await updateLatestReprintPhar();

			expect( downloadFile ).not.toHaveBeenCalled();
		} );

		it( 'downloads when a newer release tag is available', async () => {
			fs.writeFileSync( pharPath, 'OLD' );
			fs.writeFileSync( versionPath, JSON.stringify( { tag: 'v1.0.0' } ) );
			mockLatestRelease( 'v1.2.3' );

			await updateLatestReprintPhar();

			expect( downloadFile ).toHaveBeenCalledTimes( 1 );
			expect( JSON.parse( fs.readFileSync( versionPath, 'utf8' ) ) ).toEqual( { tag: 'v1.2.3' } );
		} );

		it( 'does nothing when the latest release has no reprint.phar asset', async () => {
			mockLatestRelease( 'v1.2.3', 'something-else.zip' );

			await updateLatestReprintPhar();

			expect( downloadFile ).not.toHaveBeenCalled();
			expect( fs.existsSync( pharPath ) ).toBe( false );
		} );

		it( 'propagates a failed GitHub API response', async () => {
			vi.mocked( global.fetch ).mockResolvedValue( { ok: false, status: 503 } as Response );

			await expect( updateLatestReprintPhar() ).rejects.toThrow( 'HTTP 503' );
			expect( downloadFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'ensureReprintPharAvailable', () => {
		it( 'returns the cached path without hitting the network when the phar exists', async () => {
			fs.writeFileSync( pharPath, 'PHAR' );

			await expect( ensureReprintPharAvailable() ).resolves.toBe( pharPath );

			expect( global.fetch ).not.toHaveBeenCalled();
			expect( downloadFile ).not.toHaveBeenCalled();
		} );

		it( 'downloads the latest release when no phar is cached', async () => {
			mockLatestRelease( 'v1.2.3' );

			await expect( ensureReprintPharAvailable() ).resolves.toBe( pharPath );

			expect( global.fetch ).toHaveBeenCalledTimes( 1 );
			expect( downloadFile ).toHaveBeenCalledTimes( 1 );
			expect( fs.existsSync( pharPath ) ).toBe( true );
		} );

		it( 'throws when the download cannot be resolved', async () => {
			mockLatestRelease( 'v1.2.3', 'something-else.zip' );

			await expect( ensureReprintPharAvailable() ).rejects.toThrow( 'Unable to resolve' );
		} );
	} );
} );
