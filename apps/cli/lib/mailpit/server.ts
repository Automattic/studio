import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { portFinder } from '@studio/common/lib/port-finder';
import { extract as extractTar } from 'tar';
import { isProcessRunning, startProcess, stopProcess } from 'cli/lib/daemon-client';
import {
	getMailpitBinaryPath,
	getMailpitDir,
	getPortsPath,
	MAILPIT_VERSION,
	readPorts,
} from 'cli/lib/mailpit/paths';

export const MAILPIT_PROCESS_NAME = 'studio-mailpit';

// The release's own SHA-256 digests, pinned so a download is checked against values
// that did not come from the same place as the download.
const MAILPIT_ASSETS: Record< string, { name: string; sha256: string } > = {
	'darwin-arm64': {
		name: 'mailpit-darwin-arm64.tar.gz',
		sha256: '23709bd727f20da2290de6a2a40c4685c48a3127586d77370efd1a3a595f9ef6',
	},
	'darwin-x64': {
		name: 'mailpit-darwin-amd64.tar.gz',
		sha256: 'd7f3d0964cd2ea4c2a7d10660a12e02876718e67d88ced390d9cd90350a453da',
	},
	'linux-arm64': {
		name: 'mailpit-linux-arm64.tar.gz',
		sha256: 'e1e45d1dc72bd497fb262a1e4100178eee057c42c5fc36d143eb8621769e1137',
	},
	'linux-x64': {
		name: 'mailpit-linux-amd64.tar.gz',
		sha256: '4b5993c978e8604c70d43927e2ad103b311bba3b1822fa0cf1d4ee4ec890a93c',
	},
	'win32-arm64': {
		name: 'mailpit-windows-arm64.zip',
		sha256: '663a92d2741421ef33be6aff5eff1c1ad95579d66a41d6067d1209ff78951acb',
	},
	'win32-x64': {
		name: 'mailpit-windows-amd64.zip',
		sha256: '16915767a6c95dca569336e8f561f91cf355e9a33c57b91deedcc10a4bba7fd4',
	},
};

const HTTP_PORT_START = 8025;
const SMTP_PORT_START = 1025;
const READY_TIMEOUT_MS = 10_000;

async function answersAsMailpit( httpPort: number ): Promise< boolean > {
	try {
		const response = await fetch( `http://127.0.0.1:${ httpPort }/api/v1/info`, {
			signal: AbortSignal.timeout( 1_000 ),
		} );
		return response.ok && 'Version' in ( await response.json() );
	} catch {
		return false;
	}
}

async function waitUntilAnswering( httpPort: number ): Promise< void > {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while ( ! ( await answersAsMailpit( httpPort ) ) ) {
		if ( Date.now() > deadline ) {
			throw new Error( `Mailpit did not start answering on port ${ httpPort }` );
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
	}
}

/**
 * Starts the shared Mailpit server unless it is already answering on its recorded
 * ports, downloading Mailpit on first use.
 */
export async function ensureMailpitRunning(): Promise< void > {
	const recorded = readPorts();
	if ( recorded && ( await answersAsMailpit( recorded.httpPort ) ) ) {
		return;
	}
	if ( recorded && ( await isProcessRunning( MAILPIT_PROCESS_NAME ) ) ) {
		// Still starting, for another site starting at the same time.
		try {
			await waitUntilAnswering( recorded.httpPort );
			return;
		} catch {
			await stopProcess( MAILPIT_PROCESS_NAME );
		}
	}

	await ensureMailpitBinary();
	const httpPort = await portFinder.getOpenPort( recorded?.httpPort ?? HTTP_PORT_START );
	const smtpPort = await portFinder.getOpenPort( recorded?.smtpPort ?? SMTP_PORT_START );
	fs.mkdirSync( getMailpitDir(), { recursive: true } );
	fs.writeFileSync( getPortsPath(), JSON.stringify( { httpPort, smtpPort } ) );
	await startProcess(
		MAILPIT_PROCESS_NAME,
		path.resolve( import.meta.dirname, 'mailpit-daemon.mjs' ),
		{
			args: [
				getMailpitBinaryPath(),
				'--listen',
				`127.0.0.1:${ httpPort }`,
				'--smtp',
				`127.0.0.1:${ smtpPort }`,
				'--database',
				path.join( getMailpitDir(), 'mailpit.db' ),
				'--disable-version-check',
				'--quiet',
			],
		}
	);
	await waitUntilAnswering( httpPort );
}

async function ensureMailpitBinary(): Promise< void > {
	const binaryPath = getMailpitBinaryPath();
	if ( fs.existsSync( binaryPath ) ) {
		return;
	}
	const asset = MAILPIT_ASSETS[ `${ process.platform }-${ process.arch }` ];
	if ( ! asset ) {
		throw new Error( `Mailpit is not available for ${ process.platform }-${ process.arch }` );
	}

	const workDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-mailpit-' ) );
	try {
		const archivePath = path.join( workDir, asset.name );
		await downloadFile(
			`https://github.com/axllent/mailpit/releases/download/${ MAILPIT_VERSION }/${ asset.name }`,
			archivePath
		);
		const actual = crypto
			.createHash( 'sha256' )
			.update( await fs.promises.readFile( archivePath ) )
			.digest( 'hex' );
		if ( actual !== asset.sha256 ) {
			throw new Error( `SHA-256 mismatch for ${ asset.name }: got ${ actual }` );
		}
		if ( asset.name.endsWith( '.zip' ) ) {
			await extractZip( archivePath, workDir );
		} else {
			await extractTar( { file: archivePath, cwd: workDir } );
		}
		// Copied into place last, under a temporary name and then renamed, so a
		// process checking for the binary never sees a partial file.
		fs.mkdirSync( path.dirname( binaryPath ), { recursive: true } );
		const partialPath = `${ binaryPath }.${ process.pid }.partial`;
		fs.copyFileSync( path.join( workDir, path.basename( binaryPath ) ), partialPath );
		fs.chmodSync( partialPath, 0o755 );
		fs.renameSync( partialPath, binaryPath );
	} finally {
		fs.rmSync( workDir, { recursive: true, force: true } );
	}
}
