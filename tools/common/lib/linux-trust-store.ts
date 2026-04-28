import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFilePromise = promisify( execFile );

export const LINUX_SYSTEM_CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
export const LINUX_TRUST_STORE_PATH = '/usr/local/share/ca-certificates/studio-ca.crt';
export const LINUX_NSS_NICKNAME = 'WordPress Studio CA';

export async function isCATrustedOnLinux( caPath: string ): Promise< boolean > {
	try {
		await execFilePromise( 'openssl', [ 'verify', '-CAfile', LINUX_SYSTEM_CA_BUNDLE, caPath ] );
		return true;
	} catch {
		return false;
	}
}

export function buildLinuxTrustInstallCommand( caPath: string ): string {
	return `install -m 0644 "${ caPath }" "${ LINUX_TRUST_STORE_PATH }" && update-ca-certificates`;
}

// Snap-Chromium uses a sandboxed NSS DB under ~/snap/chromium/, separate
// from the standard ~/.pki/nssdb that other Chromium-family browsers read.
export function getLinuxNssDbCandidates( homeDir: string = os.homedir() ): string[] {
	const candidates: string[] = [ path.join( homeDir, '.pki', 'nssdb' ) ];
	const snapChromiumDataDir = path.join( homeDir, 'snap', 'chromium' );
	if ( existsSync( snapChromiumDataDir ) ) {
		candidates.push( path.join( snapChromiumDataDir, 'current', '.pki', 'nssdb' ) );
	}
	return candidates;
}

// Best-effort: failures are logged but never thrown — system trust install
// is the source of truth, NSS imports are an additive convenience.
export async function importCAIntoUserNssDbsLinux( caPath: string ): Promise< void > {
	for ( const db of getLinuxNssDbCandidates() ) {
		try {
			mkdirSync( db, { recursive: true } );
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
