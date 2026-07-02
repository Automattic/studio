import fs from 'fs/promises';
import os from 'os';
import nodePath from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import {
	getWordPressOrgStorageStateLockFilePath,
	getWordPressOrgStorageStatePath,
} from '@studio/common/lib/well-known-paths';
import { writeFile } from 'atomically';
import { chromium, type BrowserContext } from 'playwright-core';
import { WORDPRESS_ORG_LOGIN_URL } from 'src/constants';

/**
 * WordPress.org authentication for plugin development.
 *
 * WordPress.org has no OAuth or API tokens, and its login form is guarded by
 * reCAPTCHA that reliably detects Electron's Chromium. So — like pressship —
 * we drive a *real* browser: the user's installed Google Chrome, launched via
 * Playwright with `channel: 'chrome'` (their actual Chrome app, not a bundled
 * "Chrome for Testing"). It opens in a throwaway profile (a temp user-data
 * dir), isolated from their normal Chrome session, so none of their cookies
 * or passwords are involved. After login we capture the WordPress.org cookies
 * and persist them to ~/.studio/wordpress-org-storage.json; that file is the
 * source of truth for account status.
 */

export interface WordPressOrgAccount {
	username: string;
	profileUrl: string;
}

interface StorageStateCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
}

interface WordPressOrgStorageState {
	cookies: StorageStateCookie[];
	origins: [];
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_MS = 1000;
// A page that requires login; used to confirm the captured session works.
const LOGIN_VERIFICATION_URL = 'https://wordpress.org/plugins/developers/add/';
const LOGIN_REQUIRED_PATTERN = /please log in|log in to submit|before you can upload/i;

export function isWordPressOrgDomain( domain: string ): boolean {
	const normalized = domain.replace( /^\./, '' );
	return normalized === 'wordpress.org' || normalized.endsWith( '.wordpress.org' );
}

export function usernameFromLoggedInCookieValue( value: string ): string | undefined {
	let decoded = value;
	try {
		decoded = decodeURIComponent( value );
	} catch {
		// Keep the raw value; the username segment may still be readable.
	}
	const username = decoded.split( '|' )[ 0 ]?.trim();
	return username || undefined;
}

/**
 * Derives the logged-in account from a cookie list. WordPress.org sets a
 * `*logged_in*` cookie whose value starts with the username.
 */
export function accountFromCookies(
	cookies: { name: string; value: string; domain: string }[]
): WordPressOrgAccount | undefined {
	for ( const cookie of cookies ) {
		if ( ! cookie.name.includes( 'logged_in' ) ) {
			continue;
		}
		if ( ! cookie.domain || ! isWordPressOrgDomain( cookie.domain ) ) {
			continue;
		}
		const username = usernameFromLoggedInCookieValue( cookie.value );
		if ( username ) {
			return {
				username,
				profileUrl: `https://profiles.wordpress.org/${ encodeURIComponent( username ) }/`,
			};
		}
	}
	return undefined;
}

async function readStorageState(): Promise< WordPressOrgStorageState | null > {
	try {
		const raw = await fs.readFile( getWordPressOrgStorageStatePath(), 'utf8' );
		const parsed = JSON.parse( raw ) as WordPressOrgStorageState;
		return Array.isArray( parsed?.cookies ) ? parsed : null;
	} catch {
		return null;
	}
}

async function saveStorageState( context: BrowserContext ): Promise< void > {
	const cookies = ( await context.cookies() ).filter( ( cookie ) =>
		isWordPressOrgDomain( cookie.domain ?? '' )
	);
	const state: WordPressOrgStorageState = {
		cookies: cookies.map( ( cookie ) => ( {
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain ?? '',
			path: cookie.path ?? '/',
			expires: cookie.expires ?? -1,
			httpOnly: Boolean( cookie.httpOnly ),
			secure: Boolean( cookie.secure ),
		} ) ),
		origins: [],
	};
	const lockPath = getWordPressOrgStorageStateLockFilePath();
	await lockFileAsync( lockPath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
	try {
		const statePath = getWordPressOrgStorageStatePath();
		await writeFile( statePath, `${ JSON.stringify( state, null, 2 ) }\n` );
		// Session cookies grant full account access; keep the file user-only.
		await fs.chmod( statePath, 0o600 );
	} finally {
		await unlockFileAsync( lockPath );
	}
}

/**
 * The connected account, if any — read from the saved cookie snapshot.
 * Cheap: no browser, no network.
 */
export async function getWordPressOrgAccount(): Promise< WordPressOrgAccount | undefined > {
	const state = await readStorageState();
	return state ? accountFromCookies( state.cookies ) : undefined;
}

function delay( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

// One login browser at a time; concurrent callers share the same attempt.
let activeLogin: Promise< WordPressOrgAccount > | null = null;

export function loginToWordPressOrg(): Promise< WordPressOrgAccount > {
	if ( activeLogin ) {
		return activeLogin;
	}
	activeLogin = runLogin().finally( () => {
		activeLogin = null;
	} );
	return activeLogin;
}

async function launchChromeContext( userDataDir: string ): Promise< BrowserContext > {
	try {
		// `channel: 'chrome'` uses the system-installed Google Chrome (the real
		// browser app), not Playwright's bundled Chromium.
		return await chromium.launchPersistentContext( userDataDir, {
			channel: 'chrome',
			headless: false,
			viewport: null,
		} );
	} catch ( error ) {
		throw new Error(
			'Could not open Google Chrome for WordPress.org login. Make sure Google Chrome is installed. ' +
				( error instanceof Error ? error.message : String( error ) )
		);
	}
}

async function runLogin(): Promise< WordPressOrgAccount > {
	const userDataDir = await fs.mkdtemp( nodePath.join( os.tmpdir(), 'studio-wporg-login-' ) );
	const context = await launchChromeContext( userDataDir );

	let closedByUser = false;
	context.on( 'close', () => {
		closedByUser = true;
	} );

	try {
		const page = context.pages()[ 0 ] ?? ( await context.newPage() );
		await page.goto( WORDPRESS_ORG_LOGIN_URL, { waitUntil: 'domcontentloaded' } );

		const deadline = Date.now() + LOGIN_TIMEOUT_MS;
		while ( Date.now() < deadline ) {
			if ( closedByUser ) {
				throw new Error( 'The login window was closed before sign-in completed.' );
			}
			const account = accountFromCookies( await context.cookies() );
			if ( account && ( await sessionIsValid( context ) ) ) {
				await saveStorageState( context );
				return account;
			}
			await delay( LOGIN_POLL_MS );
		}
		throw new Error( 'Timed out waiting for the WordPress.org login to complete.' );
	} finally {
		await context.close().catch( () => undefined );
		await fs.rm( userDataDir, { recursive: true, force: true } ).catch( () => undefined );
	}
}

async function sessionIsValid( context: BrowserContext ): Promise< boolean > {
	const page = await context.newPage();
	try {
		await page.goto( LOGIN_VERIFICATION_URL, { waitUntil: 'domcontentloaded' } );
		const body = await page.locator( 'body' ).innerText( { timeout: 10_000 } );
		return ! LOGIN_REQUIRED_PATTERN.test( body );
	} catch {
		return false;
	} finally {
		await page.close().catch( () => undefined );
	}
}

export async function logoutFromWordPressOrg(): Promise< void > {
	const lockPath = getWordPressOrgStorageStateLockFilePath();
	await lockFileAsync( lockPath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
	try {
		await fs.rm( getWordPressOrgStorageStatePath(), { force: true } );
	} finally {
		await unlockFileAsync( lockPath );
	}
}
