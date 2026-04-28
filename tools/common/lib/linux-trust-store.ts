import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFilePromise = promisify( execFile );

export const LINUX_SYSTEM_CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
export const LINUX_TRUST_STORE_PATH = '/usr/local/share/ca-certificates/studio-ca.crt';
export const LINUX_NSS_NICKNAME = 'WordPress Studio CA';

/**
 * Check whether the given root CA is trusted by the Debian/Ubuntu system trust
 * bundle (`/etc/ssl/certs/ca-certificates.crt`). This is the bundle consulted
 * by curl, wget, Node, OpenSSL, and most apt-installed browsers.
 */
export async function isCATrustedOnLinux( caPath: string ): Promise< boolean > {
	try {
		await execFilePromise( 'openssl', [ 'verify', '-CAfile', LINUX_SYSTEM_CA_BUNDLE, caPath ] );
		return true;
	} catch {
		return false;
	}
}

/**
 * Build the shell command used (via sudo-prompt → pkexec) to install a CA
 * into the system trust store. Copies the CA into
 * `/usr/local/share/ca-certificates/` (the conventional location for
 * locally-administered roots on Debian/Ubuntu) and then runs
 * `update-ca-certificates`, which appends the cert to the system bundle.
 */
export function buildLinuxTrustInstallCommand( caPath: string ): string {
	return `install -m 0644 "${ caPath }" "${ LINUX_TRUST_STORE_PATH }" && update-ca-certificates`;
}

/**
 * Per-user NSS database paths Chromium-family browsers consult. The system
 * trust bundle alone isn't enough on stock Ubuntu desktops because the
 * default Chromium ships as a Snap (sandboxed NSS) and Chrome/Brave/Edge
 * read `~/.pki/nssdb`.
 *
 * Only the standard `~/.pki/nssdb` is returned unconditionally — that's
 * shared by all non-sandboxed Chromium-family browsers. The Snap-Chromium
 * path is included only when the snap data dir already exists (i.e. the
 * user actually has Snap-Chromium installed).
 *
 * Firefox per-profile NSS is intentionally not handled here — profile
 * discovery is messy and Firefox lets users import via about:preferences.
 */
export function getLinuxNssDbCandidates( homeDir: string = os.homedir() ): string[] {
	const candidates: string[] = [ path.join( homeDir, '.pki', 'nssdb' ) ];
	const snapChromiumDataDir = path.join( homeDir, 'snap', 'chromium' );
	if ( existsSync( snapChromiumDataDir ) ) {
		candidates.push( path.join( snapChromiumDataDir, 'current', '.pki', 'nssdb' ) );
	}
	return candidates;
}

/**
 * Best-effort: import the CA into every per-user NSS DB returned by
 * `getLinuxNssDbCandidates`. Each import is independent — if `certutil`
 * is missing or one DB fails, we log and continue. Never throws; trust
 * still succeeds via the system bundle for browsers that read it.
 */
export async function importCAIntoUserNssDbsLinux( caPath: string ): Promise< void > {
	for ( const db of getLinuxNssDbCandidates() ) {
		try {
			mkdirSync( db, { recursive: true } );
			// Remove any prior entry under this nickname so re-imports are clean.
			await execFilePromise( 'certutil', [
				'-d',
				`sql:${ db }`,
				'-D',
				'-n',
				LINUX_NSS_NICKNAME,
			] ).catch( () => undefined );
			await execFilePromise( 'certutil', [
				'-d',
				`sql:${ db }`,
				'-A',
				'-t',
				'C,,',
				'-n',
				LINUX_NSS_NICKNAME,
				'-i',
				caPath,
			] );
			console.log( `Imported Studio CA into NSS DB: ${ db }` );
		} catch ( error ) {
			const message = error instanceof Error ? error.message : String( error );
			console.warn( `Could not import Studio CA into NSS DB ${ db }: ${ message }` );
		}
	}
}
