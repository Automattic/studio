import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import {
	getMailpitBinaryName,
	getMailpitReleaseAssetName,
	MAILPIT_VERSION,
} from '@studio/common/lib/mailpit';
import { extract as extractTar } from 'tar';
import { getBundledMailpitBinaryPath, getRuntimeMailpitBinaryPath } from './paths';

const WAIT_POLL_INTERVAL_MS = 1_000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1_000;

const MAILPIT_RELEASE_BASE_URL = 'https://github.com/axllent/mailpit/releases/download';

/**
 * Resolve a usable MailPit binary, downloading it on demand when necessary.
 *
 * Desktop builds bundle a per-platform binary; the npm-published CLI ships
 * cross-platform and has none, so we fetch the matching release asset into
 * ~/.studio on first use. Returns the absolute path to the binary.
 */
export async function ensureMailpitBinaryAvailable(): Promise< string > {
	const bundledPath = getBundledMailpitBinaryPath();
	if ( fs.existsSync( bundledPath ) ) {
		return bundledPath;
	}

	const runtimePath = getRuntimeMailpitBinaryPath();
	if ( ! fs.existsSync( runtimePath ) ) {
		await downloadAndInstall( runtimePath );
	}

	return runtimePath;
}

async function downloadAndInstall( destPath: string ): Promise< void > {
	const platform = process.platform;
	const arch = process.arch;
	const assetName = getMailpitReleaseAssetName( platform, arch );
	const url = `${ MAILPIT_RELEASE_BASE_URL }/${ MAILPIT_VERSION }/${ assetName }`;

	const versionDir = path.dirname( destPath );
	const mailpitBinRoot = path.dirname( versionDir );

	// Ensure ~/.studio/mailpit-bin/ exists before the exclusive mkdir below.
	fs.mkdirSync( mailpitBinRoot, { recursive: true } );

	// Atomically claim this version's install slot. If another process already
	// created the directory it is either mid-download or finished.
	try {
		fs.mkdirSync( versionDir );
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'EEXIST' ) {
			await waitForBinary( destPath );
			return;
		}
		throw err;
	}

	// We own the slot — clean up on failure so the next attempt can retry.
	const downloadPath = path.join( versionDir, assetName );
	const extractDir = fs.mkdtempSync( path.join( os.tmpdir(), 'mailpit-' ) );

	try {
		console.log( `Downloading MailPit ${ MAILPIT_VERSION } for ${ platform }-${ arch }…` );
		await downloadFile( url, downloadPath );
		await verifyChecksum( downloadPath, assetName );

		if ( assetName.endsWith( '.zip' ) ) {
			await extractZip( downloadPath, extractDir );
		} else {
			await extractTar( { file: downloadPath, cwd: extractDir } );
		}

		const extractedBinaryPath = path.join( extractDir, getMailpitBinaryName( platform ) );
		if ( ! fs.existsSync( extractedBinaryPath ) ) {
			throw new Error( `MailPit binary not found inside ${ assetName }` );
		}

		await fs.promises.copyFile( extractedBinaryPath, destPath );
		if ( platform !== 'win32' ) {
			await fs.promises.chmod( destPath, 0o755 );
		}
	} catch ( err ) {
		fs.rmSync( versionDir, { recursive: true, force: true } );
		throw err;
	} finally {
		fs.rmSync( downloadPath, { force: true } );
		fs.rmSync( extractDir, { recursive: true, force: true } );
	}
}

// MailPit publishes a `checksums.txt` per release with `<sha256>  <filename>`
// lines. Verify the downloaded asset against it before we execute the binary.
async function verifyChecksum( filePath: string, assetName: string ): Promise< void > {
	const checksumsUrl = `${ MAILPIT_RELEASE_BASE_URL }/${ MAILPIT_VERSION }/checksums.txt`;
	const response = await fetch( checksumsUrl );
	if ( ! response.ok ) {
		throw new Error(
			`Could not fetch MailPit checksums (status ${ response.status }) from ${ checksumsUrl }`
		);
	}
	const checksums = await response.text();

	const expected = checksums
		.split( '\n' )
		.map( ( line ) => line.trim().split( /\s+/ ) )
		.find( ( [ , name ] ) => name === assetName )?.[ 0 ];

	if ( ! expected ) {
		throw new Error( `No checksum listed for ${ assetName } in ${ checksumsUrl }` );
	}

	const data = await fs.promises.readFile( filePath );
	const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
	if ( actual !== expected ) {
		throw new Error(
			`SHA-256 mismatch for ${ assetName }:\n  expected ${ expected }\n  got      ${ actual }`
		);
	}
}

async function waitForBinary( binaryPath: string ): Promise< void > {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		if ( fs.existsSync( binaryPath ) ) {
			return;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, WAIT_POLL_INTERVAL_MS ) );
	}
	throw new Error(
		`Timed out waiting for MailPit binary at ${ binaryPath }. ` +
			`Another process may have failed to install it. ` +
			`Delete ${ path.dirname( binaryPath ) } and retry.`
	);
}
