import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { portFinder } from '@studio/common/lib/port-finder';
import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { extract as extractTar } from 'tar';
import { z } from 'zod';
import { isProcessRunning, startProcess, stopProcess } from 'cli/lib/daemon-client';
import {
	getMailpitBinaryPath,
	getMailpitDir,
	getMailpitInboxUrl,
	getPortsPath,
	MAILPIT_VERSION,
	readPorts,
} from 'cli/lib/mailpit/paths';
// Imported by the site start it serves, so only used once a site is starting.
import { getRunningSiteCount, subscribeForReadyOrExit } from 'cli/lib/wordpress-server-manager';
import type { Logger } from 'cli/logger';

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

// A network that hangs rather than failing would otherwise hold up the site start
// for minutes. The next site start tries again.
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;

const HTTP_PORT_START = 8025;
const SMTP_PORT_START = 1025;

/**
 * How the email inbox fared as a site started: a fixed set, so it can be counted
 * in Tracks without carrying any error text.
 */
export type EmailInboxStatus =
	| 'running'
	| 'started'
	| 'unsupported_platform'
	| 'download_failed'
	| 'start_failed';

class EmailInboxError extends Error {
	constructor(
		readonly status: EmailInboxStatus,
		cause: unknown
	) {
		super( cause instanceof Error ? cause.message : String( cause ) );
	}
}

/**
 * Starts the shared Mailpit server unless it is running, downloading Mailpit on
 * first use. A site starts either way: when the inbox can't start, its email goes
 * where PHP sends it by default, and a warning says so.
 */
export async function startMailpitIfNeeded(
	logger: Logger< string >
): Promise< EmailInboxStatus > {
	if ( readPorts() && ( await isProcessRunning( MAILPIT_PROCESS_NAME ) ) ) {
		return 'running';
	}

	logger.reportStart( SiteCommandLoggerAction.START_EMAIL_INBOX, __( 'Starting email inbox…' ) );
	try {
		await startMailpit();
	} catch ( error ) {
		const status = error instanceof EmailInboxError ? error.status : 'start_failed';
		logger.reportWarning(
			sprintf(
				/* translators: %s: why the email inbox could not start */
				__( 'Email the site sends will not reach the Studio inbox: %s' ),
				error instanceof Error ? error.message : String( error )
			)
		);
		return status;
	}
	logger.reportSuccess(
		sprintf(
			/* translators: %s: the email inbox URL */
			__( 'Email inbox started at %s' ),
			getMailpitInboxUrl() ?? ''
		)
	);
	return 'started';
}

async function startMailpit(): Promise< void > {
	const asset = MAILPIT_ASSETS[ `${ process.platform }-${ process.arch }` ];
	if ( ! asset ) {
		throw new EmailInboxError(
			'unsupported_platform',
			`Mailpit is not available for ${ process.platform }-${ process.arch }`
		);
	}
	try {
		await ensureMailpitBinary( asset );
	} catch ( error ) {
		throw new EmailInboxError( 'download_failed', error );
	}

	// Left behind if Mailpit was killed outright, and would send email nowhere.
	if ( ! ( await isProcessRunning( MAILPIT_PROCESS_NAME ) ) ) {
		fs.rmSync( getPortsPath(), { force: true } );
	}
	const httpPort = await portFinder.getOpenPort( HTTP_PORT_START );
	const smtpPort = await portFinder.getOpenPort( SMTP_PORT_START );
	fs.mkdirSync( getMailpitDir(), { recursive: true } );
	const readyOrExit = await subscribeForReadyOrExit( MAILPIT_PROCESS_NAME );
	try {
		const { pmId } = await startProcess(
			MAILPIT_PROCESS_NAME,
			path.resolve( import.meta.dirname, 'mailpit-daemon.mjs' ),
			{
				args: [
					getPortsPath(),
					String( httpPort ),
					String( smtpPort ),
					getMailpitBinaryPath(),
					'--listen',
					`127.0.0.1:${ httpPort }`,
					'--smtp',
					`127.0.0.1:${ smtpPort }`,
					'--database',
					path.join( getMailpitDir(), 'mailpit.db' ),
					'--disable-version-check',
				],
			}
		);
		// Another site starting at the same time may have started it, and seen it
		// become ready, already.
		if ( ! readPorts() ) {
			await readyOrExit.waitFor( pmId );
		}
	} catch ( error ) {
		await stopProcess( MAILPIT_PROCESS_NAME ).catch( () => undefined );
		throw new EmailInboxError( 'start_failed', error );
	} finally {
		readyOrExit.dispose();
	}
}

/**
 * Stops the shared Mailpit server once no site is running. Its inbox stays on
 * disk for the next time a site starts.
 */
export async function stopMailpitIfNoSitesRunning( logger: Logger< string > ): Promise< void > {
	if (
		( await getRunningSiteCount() ) !== 0 ||
		! ( await isProcessRunning( MAILPIT_PROCESS_NAME ) )
	) {
		return;
	}
	logger.reportStart( SiteCommandLoggerAction.STOP_EMAIL_INBOX, __( 'Stopping email inbox…' ) );
	await stopProcess( MAILPIT_PROCESS_NAME );
	logger.reportSuccess( __( 'Email inbox stopped' ) );
}

/**
 * How many messages the inbox holds and how many of those have been opened, for
 * Tracks. `undefined` when the inbox isn't answering.
 */
export async function getEmailInboxCounts(): Promise<
	{ messages: number; read: number } | undefined
> {
	const inboxUrl = getMailpitInboxUrl();
	if ( ! inboxUrl ) {
		return undefined;
	}
	try {
		const response = await fetch( `${ inboxUrl }/api/v1/info`, {
			signal: AbortSignal.timeout( 1_000 ),
		} );
		const info = z
			.object( { Messages: z.number(), Unread: z.number() } )
			.parse( await response.json() );
		return { messages: info.Messages, read: info.Messages - info.Unread };
	} catch {
		return undefined;
	}
}
async function ensureMailpitBinary( asset: { name: string; sha256: string } ): Promise< void > {
	const binaryPath = getMailpitBinaryPath();
	if ( fs.existsSync( binaryPath ) ) {
		return;
	}

	const workDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-mailpit-' ) );
	try {
		const archivePath = path.join( workDir, asset.name );
		await downloadFile(
			`https://github.com/axllent/mailpit/releases/download/${ MAILPIT_VERSION }/${ asset.name }`,
			archivePath,
			undefined,
			{ stallTimeoutMs: DOWNLOAD_STALL_TIMEOUT_MS }
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
