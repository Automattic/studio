import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { __ } from '@wordpress/i18n';
import { openExporter, type PullSource } from 'cli/lib/pull/pull-source';
import { toLoggerError, wpcomSites } from 'cli/lib/sync-api';
import { LoggerError } from 'cli/logger';

/**
 * The one key this machine signs Reprint requests with. A site holds one key, so a key per local
 * site would let two local sites pulling the same remote replace each other's key mid-pull.
 */
function getReprintKeyPath(): string {
	return path.join( os.homedir(), '.studio', 'reprint-key.pem' );
}

/** The argument every Reprint command that signs requests needs. */
export function reprintKeyArgs(): string[] {
	return [ `--private-key-path=${ getReprintKeyPath() }` ];
}

/**
 * Installs this machine's key on the site, generating the key on first use. Installing on every
 * pull replaces a key another machine installed since.
 */
export async function ensureReprintKey( source: PullSource ): Promise< void > {
	const publicKey = await loadOrCreateReprintKey( getReprintKeyPath() );

	try {
		await wpcomSites.pull!.installExporterKey(
			{ token: source.wpComToken.accessToken },
			{ id: source.wpComSite.id },
			publicKey
		);
	} catch ( error ) {
		throw toLoggerError(
			error,
			__( 'Failed to install the migration key on the WordPress.com site' )
		);
	}
	// Opens the export window, which stays closed on a site that had no key.
	const reenabled = await openExporter( source );
	if ( ! reenabled.hasKey ) {
		throw new LoggerError(
			__( 'The WordPress.com site did not accept the migration key. Please try again.' )
		);
	}
}

/**
 * Returns the public key for the private key at `keyPath`, creating the key if there is none.
 * The public key is the one line of base64 SPKI that Reprint enrolls.
 */
export async function loadOrCreateReprintKey( keyPath: string ): Promise< string > {
	if ( ! fs.existsSync( keyPath ) ) {
		const { privateKey } = await promisify( crypto.generateKeyPair )( 'rsa', {
			modulusLength: 3072,
			privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
			publicKeyEncoding: { type: 'spki', format: 'pem' },
		} );
		fs.mkdirSync( path.dirname( keyPath ), { recursive: true } );
		// Written whole beside the target, then linked into place: a pull starting at the same time
		// sees no key or the complete one, and the first link wins.
		const temporaryPath = `${ keyPath }.${ crypto.randomBytes( 8 ).toString( 'hex' ) }.tmp`;
		fs.writeFileSync( temporaryPath, privateKey, { mode: 0o600 } );
		try {
			fs.linkSync( temporaryPath, keyPath );
		} catch ( error ) {
			if ( ( error as NodeJS.ErrnoException ).code !== 'EEXIST' ) {
				throw error;
			}
		} finally {
			fs.rmSync( temporaryPath, { force: true } );
		}
	}

	return crypto
		.createPublicKey( fs.readFileSync( keyPath, 'utf8' ) )
		.export( { type: 'spki', format: 'der' } )
		.toString( 'base64' );
}
