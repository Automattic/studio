import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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

// Returns true only when every expected NSS DB contains the Studio CA. Used by
// isRootCATrusted() so the **Trust Certificate** button reappears if a
// Chromium-family browser (notably Snap-Chromium) is installed *after* the
// initial system-bundle trust — that browser's sandboxed NSS DB starts empty
// and only this check surfaces the gap.
export async function isCAImportedInUserNssDbsLinux(
	homeDir: string = os.homedir()
): Promise< boolean > {
	for ( const db of getLinuxNssDbCandidates( homeDir ) ) {
		try {
			await execFilePromise( 'certutil', [ '-d', `sql:${ db }`, '-L', '-n', LINUX_NSS_NICKNAME ] );
		} catch {
			return false;
		}
	}
	return true;
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

// Firefox keeps a private NSS DB per profile (cert9.db). The auto-trust
// flow has to walk every install root — apt installs use ~/.mozilla,
// Snap and Flatpak each have their own profile root.
function getFirefoxProfileRootsLinux( homeDir: string ): string[] {
	return [
		path.join( homeDir, '.mozilla', 'firefox' ),
		path.join( homeDir, 'snap', 'firefox', 'common', '.mozilla', 'firefox' ),
		path.join( homeDir, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox' ),
	];
}

// Returns profile dirs that already have a Mozilla NSS DB (cert9.db).
// Profiles without cert9.db are skipped: Firefox creates the DB on first
// launch, so there's nothing to import into until the user has opened the
// browser at least once.
export function getLinuxFirefoxProfileDbDirs( homeDir: string = os.homedir() ): string[] {
	const dirs: string[] = [];
	for ( const root of getFirefoxProfileRootsLinux( homeDir ) ) {
		if ( ! existsSync( root ) ) continue;
		let entries: string[];
		try {
			entries = readdirSync( root );
		} catch {
			continue;
		}
		for ( const entry of entries ) {
			// Firefox profile dirs end with `.default`, `.default-release`,
			// `.default-esr`, etc. (per profiles.ini conventions).
			if ( ! /\.default(?:-[^/]+)?$/.test( entry ) ) continue;
			const profileDir = path.join( root, entry );
			if ( existsSync( path.join( profileDir, 'cert9.db' ) ) ) {
				dirs.push( profileDir );
			}
		}
	}
	return dirs;
}

// Vacuously true when no Firefox profile exists yet (browser installed but
// never opened): there is nothing to import into, so the system+Chromium
// trust state alone is enough to consider the trust flow complete.
export async function areAllFirefoxProfilesTrustedLinux(
	homeDir: string = os.homedir()
): Promise< boolean > {
	for ( const db of getLinuxFirefoxProfileDbDirs( homeDir ) ) {
		try {
			await execFilePromise( 'certutil', [ '-d', `sql:${ db }`, '-L', '-n', LINUX_NSS_NICKNAME ] );
		} catch {
			return false;
		}
	}
	return true;
}

// Best-effort: same contract as importCAIntoUserNssDbsLinux. Profiles with
// a locked DB (Firefox is running) or missing certutil log a warning and
// the user falls back to the in-app notice + docs.
export async function importCAIntoFirefoxProfilesLinux( caPath: string ): Promise< void > {
	for ( const db of getLinuxFirefoxProfileDbDirs() ) {
		try {
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
			console.log( `Imported Studio CA into Firefox profile: ${ db }` );
		} catch ( error ) {
			const message = error instanceof Error ? error.message : String( error );
			console.warn( `Could not import Studio CA into Firefox profile ${ db }: ${ message }` );
		}
	}
}
