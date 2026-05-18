import { shell } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as Sentry from '@sentry/electron/main';
import { CERT_UNTRUSTED_ROOT, SERVER_AUTH_OID } from '@studio/common/constants';
import {
	areAllFirefoxProfilesTrustedLinux,
	buildLinuxTrustInstallCommand,
	importCAIntoFirefoxProfilesLinux,
	importCAIntoUserNssDbsLinux,
	isCAImportedInUserNssDbsLinux,
	isCATrustedOnLinux,
} from '@studio/common/lib/linux-trust-store';
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
			const { stdout } = await execFilePromise( 'certutil', [ '-verify', CA_CERT_PATH ] );

			const isTrusted = ! stdout.includes( CERT_UNTRUSTED_ROOT );
			const hasServerAuthPolicy = stdout.includes( SERVER_AUTH_OID );

			return isTrusted && hasServerAuthPolicy;
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
	} else if ( process.platform === 'linux' ) {
		// The CA is fully trusted on Linux only when it lives in the system
		// bundle (curl/openssl/Node), every Chromium-family NSS DB (including
		// Snap-Chromium's sandboxed DB), and every existing Firefox profile
		// NSS DB. Firefox profiles that don't exist yet are vacuously trusted.
		return (
			( await isCATrustedOnLinux( CA_CERT_PATH ) ) &&
			( await isCAImportedInUserNssDbsLinux() ) &&
			( await areAllFirefoxProfilesTrustedLinux() )
		);
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
		} else if ( platform === 'linux' ) {
			// Skip the sudo install when the system bundle is already trusted —
			// otherwise we'd reprompt for the polkit password just to re-sync NSS
			// (the common case when a Chromium-family browser is installed after
			// the initial trust flow).
			if ( ! ( await isCATrustedOnLinux( CA_CERT_PATH ) ) ) {
				await new Promise< void >( ( resolve, reject ) => {
					sudo.exec(
						buildLinuxTrustInstallCommand( CA_CERT_PATH ),
						{ name: 'WordPress Studio' },
						( error ) => {
							if ( error ) {
								console.error( 'Error adding certificate to system trust store:', error );
								reject( error );
							} else {
								console.log( 'Root CA trusted in Linux system trust store' );
								resolve();
							}
						}
					);
				} );
			}
			// Always run NSS imports — they're idempotent (-D before -A) and don't
			// need sudo, so re-running covers the install-browser-after-trust case.
			await importCAIntoUserNssDbsLinux( CA_CERT_PATH );
			// Firefox keeps a per-profile NSS DB; the system + Chromium imports
			// above don't reach it. Profiles that don't exist yet are skipped —
			// when the user later opens Firefox for the first time, the trust
			// check flips back to untrusted on refetch and the user clicks Trust
			// again to import into the newly created profile.
			await importCAIntoFirefoxProfilesLinux( CA_CERT_PATH );
		} else {
			console.error( 'Unsupported platform for automatic certificate trust:', platform );
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( 'Failed to trust root CA:', error );
		throw error;
	}
}
