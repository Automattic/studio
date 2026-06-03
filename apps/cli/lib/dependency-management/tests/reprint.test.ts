import crypto from 'crypto';
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

// The downloadFile mock writes this content, so the matching digest is what the GitHub API mock
// must report for verification to pass.
const PHAR_CONTENT = 'PHAR-BYTES';
const PHAR_DIGEST = `sha256:${ crypto
	.createHash( 'sha256' )
	.update( PHAR_CONTENT )
	.digest( 'hex' ) }`;

let cacheDir: string;
let pharPath: string;
let versionPath: string;

function mockLatestRelease(
	tag: string,
	{
		digest = PHAR_DIGEST,
		assetName = 'reprint.phar',
	}: { digest?: string | null; assetName?: string } = {}
): void {
	vi.mocked( global.fetch ).mockResolvedValue( {
		ok: true,
		json: async () => ( {
			tag_name: tag,
			assets: [
				{ name: assetName, browser_download_url: `https://example.test/${ assetName }`, digest },
			],
		} ),
	} as Response );
}

function writeInstalled(
	content: string,
	metadata: { tag?: string; digest?: string | null }
): void {
	fs.writeFileSync( pharPath, content );
	fs.writeFileSync( versionPath, JSON.stringify( metadata ) );
}

describe( 'reprint dependency', () => {
	beforeEach( () => {
		cacheDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-reprint-' ) );
		pharPath = path.join( cacheDir, 'reprint.phar' );
		versionPath = path.join( cacheDir, 'version.json' );
		vi.mocked( getReprintPharPath ).mockReturnValue( pharPath );
		// downloadFile writes the (fake) phar to the temp path it is given, mirroring a real download.
		vi.mocked( downloadFile ).mockImplementation( async ( _url, dest ) => {
			fs.writeFileSync( dest, PHAR_CONTENT );
		} );
		vi.stubGlobal( 'fetch', vi.fn() );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		fs.rmSync( cacheDir, { recursive: true, force: true } );
	} );

	describe( 'updateLatestReprintPhar', () => {
		it( 'downloads the phar and records the tag and digest when nothing is installed', async () => {
			mockLatestRelease( 'v1.2.3' );

			await updateLatestReprintPhar();

			expect( downloadFile ).toHaveBeenCalledTimes( 1 );
			expect( fs.existsSync( pharPath ) ).toBe( true );
			expect( JSON.parse( fs.readFileSync( versionPath, 'utf8' ) ) ).toEqual( {
				tag: 'v1.2.3',
				digest: PHAR_DIGEST,
			} );
		} );

		it( 'skips the download when the installed digest matches the latest release', async () => {
			writeInstalled( PHAR_CONTENT, { tag: 'v1.2.3', digest: PHAR_DIGEST } );
			mockLatestRelease( 'v1.2.3' );

			await updateLatestReprintPhar();

			expect( downloadFile ).not.toHaveBeenCalled();
		} );

		it( 're-downloads when the asset digest changes under an unchanged tag', async () => {
			// GitHub releases are mutable: same tag, replaced asset. The digest must drive the refresh.
			writeInstalled( 'STALE', { tag: 'v1.2.3', digest: 'sha256:0000000000000000' } );
			mockLatestRelease( 'v1.2.3' );

			await updateLatestReprintPhar();

			expect( downloadFile ).toHaveBeenCalledTimes( 1 );
			expect( JSON.parse( fs.readFileSync( versionPath, 'utf8' ) ).digest ).toBe( PHAR_DIGEST );
		} );

		it( 'rejects and does not install when the downloaded file fails digest verification', async () => {
			mockLatestRelease( 'v1.2.3', { digest: 'sha256:deadbeefdeadbeef' } );

			await expect( updateLatestReprintPhar() ).rejects.toThrow( 'digest mismatch' );

			// The unverified download must never be renamed into place.
			expect( fs.existsSync( pharPath ) ).toBe( false );
			expect( fs.existsSync( versionPath ) ).toBe( false );
		} );

		it( 'falls back to the tag when the release exposes no digest', async () => {
			writeInstalled( PHAR_CONTENT, { tag: 'v1.2.3', digest: null } );
			mockLatestRelease( 'v1.2.3', { digest: null } );

			await updateLatestReprintPhar();

			expect( downloadFile ).not.toHaveBeenCalled();
		} );

		it( 'does nothing when the latest release has no reprint.phar asset', async () => {
			mockLatestRelease( 'v1.2.3', { assetName: 'something-else.zip' } );

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
			fs.writeFileSync( pharPath, PHAR_CONTENT );

			await expect( ensureReprintPharAvailable() ).resolves.toBe( pharPath );

			expect( global.fetch ).not.toHaveBeenCalled();
			expect( downloadFile ).not.toHaveBeenCalled();
		} );

		it( 'downloads and verifies the latest release when no phar is cached', async () => {
			mockLatestRelease( 'v1.2.3' );

			await expect( ensureReprintPharAvailable() ).resolves.toBe( pharPath );

			expect( global.fetch ).toHaveBeenCalledTimes( 1 );
			expect( downloadFile ).toHaveBeenCalledTimes( 1 );
			expect( fs.existsSync( pharPath ) ).toBe( true );
		} );

		it( 'throws when the download cannot be resolved', async () => {
			mockLatestRelease( 'v1.2.3', { assetName: 'something-else.zip' } );

			await expect( ensureReprintPharAvailable() ).rejects.toThrow( 'Unable to resolve' );
		} );
	} );
} );
