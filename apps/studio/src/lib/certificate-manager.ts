import { shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as Sentry from '@sentry/electron/main';
import { getCertificatesPath } from '@studio/common/lib/well-known-paths';
import sudo from '@vscode/sudo-prompt';

const execFilePromise = promisify( execFile );

// Certificate configuration
const CA_CERT_PATH = path.join( getCertificatesPath(), 'studio-ca.crt' );

export async function openCertificate() {
	shell.showItemInFolder( CA_CERT_PATH );
}

/**
 * Checks if the root CA certificate is already trusted by the system
 * @returns A promise that resolves to true if the certificate is trusted, false otherwise
 */
export async function isRootCATrusted(): Promise< boolean > {
	if ( ! fs.existsSync( CA_CERT_PATH ) ) {
		return false;
	}

	if ( process.platform === 'win32' ) {
		try {
			// Execute certutil with more specific validation
			const { stdout } = await execFilePromise( 'certutil', [ '-verify', CA_CERT_PATH ] );

			const hasValidPolicies =
				stdout.includes( 'Verified Application Policies:' ) &&
				stdout.includes( 'Server Authentication' );

			// Only consider the certificate trusted if it has the Server Authentication policy.
			return hasValidPolicies;
		} catch ( error ) {
			return false;
		}
	} else if ( process.platform === 'darwin' ) {
		try {
			await execFilePromise( 'security', [ 'verify-cert', '-r', CA_CERT_PATH, '-p', 'ssl' ] );

			return true;
		} catch ( error ) {
			return false;
		}
	}

	return false;
}

/**
 * Trust the root CA certificate in the system trust store
 * @throws { Error } If the certificate trust operation fails
 */
export async function trustRootCA(): Promise< void > {
	try {
		// If certificate is already trusted, no need to re-trust it
		if ( await isRootCATrusted() ) {
			console.log( 'Root CA is already trusted in the system store' );
			return;
		}

		const platform = process.platform;
		if ( platform === 'win32' ) {
			// Windows - Use certutil
			await new Promise< void >( ( resolve, reject ) => {
				sudo.exec(
					`certutil -addstore -f "ROOT" "${ CA_CERT_PATH }"`,
					{ name: 'WordPress Studio' },
					( error ) => {
						if ( error ) {
							console.error( 'Error adding certificate to system trust store:', error );
							reject( error );
						} else {
							console.log( 'Root CA trusted in Windows certificate store' );
							resolve();
						}
					}
				);
			} );
		} else {
			console.error( 'Unsupported platform for automatic certificate trust:', platform );
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( 'Failed to trust root CA:', error );
		throw error;
	}
}
