import { BrowserWindow, session, type Cookie, type Session } from 'electron';
import fs from 'fs/promises';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import {
	getWordPressOrgStorageStateLockFilePath,
	getWordPressOrgStorageStatePath,
} from '@studio/common/lib/well-known-paths';
import { writeFile } from 'atomically';
import { WORDPRESS_ORG_AUTH_SESSION_PARTITION, WORDPRESS_ORG_LOGIN_URL } from 'src/constants';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getMainWindow } from 'src/main-window';

/**
 * WordPress.org authentication for plugin development.
 *
 * WordPress.org has no OAuth or API tokens, so we do what every tool does:
 * open a login window and capture the session cookies. The window runs on a
 * dedicated persistent session partition — its own cookie jar, isolated from
 * both the user's browsers and the app's default session (the same clean-
 * profile property pressship gets from a separate Chromium, without bundling
 * one). A cookie snapshot is mirrored to ~/.studio/wordpress-org-storage.json
 * so account status survives partition resets and can be shared with the CLI
 * later.
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
const WORDPRESS_ORG_SESSION_URLS = [
	'https://wordpress.org',
	'https://login.wordpress.org',
	'https://profiles.wordpress.org',
];
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
	cookies: Pick< Cookie, 'name' | 'value' | 'domain' >[]
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

// login.wordpress.org rejects unusual user agents (like Electron's default),
// so present a plain Chrome UA for the bundled Chromium version.
export function getWordPressOrgLoginUserAgent(): string {
	const platform =
		process.platform === 'darwin'
			? 'Macintosh; Intel Mac OS X 10_15_7'
			: process.platform === 'win32'
			? 'Windows NT 10.0; Win64; x64'
			: 'X11; Linux x86_64';
	return `Mozilla/5.0 (${ platform }) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ process.versions.chrome } Safari/537.36`;
}

export function getWordPressOrgSession(): Session {
	return session.fromPartition( WORDPRESS_ORG_AUTH_SESSION_PARTITION );
}

async function collectSessionCookies( authSession: Session ): Promise< Cookie[] > {
	const collected: Cookie[] = [];
	for ( const url of WORDPRESS_ORG_SESSION_URLS ) {
		collected.push( ...( await authSession.cookies.get( { url } ) ) );
	}
	return collected;
}

async function sessionWorksOnWordPressOrg( authSession: Session ): Promise< boolean > {
	try {
		const response = await authSession.fetch( LOGIN_VERIFICATION_URL, {
			headers: { 'User-Agent': getWordPressOrgLoginUserAgent() },
		} );
		if ( ! response.ok ) {
			return false;
		}
		const text = await response.text();
		return ! LOGIN_REQUIRED_PATTERN.test( text );
	} catch {
		return false;
	}
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

async function saveStorageState( authSession: Session ): Promise< void > {
	const cookies = ( await collectSessionCookies( authSession ) ).filter( ( cookie ) =>
		isWordPressOrgDomain( cookie.domain ?? '' )
	);
	const state: WordPressOrgStorageState = {
		cookies: cookies.map( ( cookie ) => ( {
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain ?? '',
			path: cookie.path ?? '/',
			expires: cookie.expirationDate ?? -1,
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
 * The connected account, if any: live partition cookies first, then the
 * on-disk snapshot. Cheap — no windows, no network.
 */
export async function getWordPressOrgAccount(): Promise< WordPressOrgAccount | undefined > {
	const fromSession = accountFromCookies( await collectSessionCookies( getWordPressOrgSession() ) );
	if ( fromSession ) {
		return fromSession;
	}
	const state = await readStorageState();
	return state ? accountFromCookies( state.cookies ) : undefined;
}

function delay( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

// One login window at a time; concurrent callers share the same attempt.
let activeLogin: Promise< WordPressOrgAccount > | null = null;
let activeLoginWindow: BrowserWindow | null = null;

export function loginToWordPressOrg(): Promise< WordPressOrgAccount > {
	if ( activeLogin ) {
		activeLoginWindow?.focus();
		return activeLogin;
	}
	activeLogin = runLogin().finally( () => {
		activeLogin = null;
		activeLoginWindow = null;
	} );
	return activeLogin;
}

async function runLogin(): Promise< WordPressOrgAccount > {
	const authSession = getWordPressOrgSession();
	const parent = await getMainWindow();
	const loginWindow = new BrowserWindow( {
		width: 720,
		height: 760,
		parent,
		title: 'Log in to WordPress.org',
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			session: authSession,
		},
	} );
	activeLoginWindow = loginWindow;
	// Session-wide, not just the top frame: the login form's reCAPTCHA runs
	// in third-party frames whose requests must carry the same plain-Chrome
	// UA, or the anti-bot check quietly fails and the submit button appears
	// to do nothing.
	authSession.setUserAgent( getWordPressOrgLoginUserAgent() );
	loginWindow.webContents.setUserAgent( getWordPressOrgLoginUserAgent() );
	// Keep WordPress.org navigation inside the login window; anything else
	// (support docs, password reset hosts, …) goes to the real browser.
	loginWindow.webContents.setWindowOpenHandler( ( { url } ) => {
		try {
			if ( isWordPressOrgDomain( new URL( url ).hostname ) ) {
				void loginWindow.webContents.loadURL( url );
			} else {
				void shellOpenExternalWrapper( url );
			}
		} catch {
			// Ignore unparseable URLs.
		}
		return { action: 'deny' };
	} );

	// The page gives no feedback when its login JS fails (anti-bot checks
	// abort the submit silently), so surface the window's own console and
	// load failures in the main-process log for diagnosis.
	loginWindow.webContents.on( 'console-message', ( _event, level, message ) => {
		console.log( `[wporg-login console:${ level }]`, message );
	} );
	loginWindow.webContents.on(
		'did-fail-load',
		( _event, errorCode, errorDescription, validatedURL ) => {
			console.error( '[wporg-login] load failed:', errorCode, errorDescription, validatedURL );
		}
	);
	loginWindow.webContents.on( 'did-navigate', ( _event, url ) => {
		console.log( '[wporg-login] navigated:', url );
	} );
	if ( process.env.NODE_ENV === 'development' ) {
		loginWindow.webContents.openDevTools( { mode: 'detach' } );
	}

	let closedByUser = false;
	loginWindow.on( 'closed', () => {
		closedByUser = true;
	} );

	try {
		await loginWindow.loadURL( WORDPRESS_ORG_LOGIN_URL );

		const deadline = Date.now() + LOGIN_TIMEOUT_MS;
		while ( Date.now() < deadline ) {
			if ( closedByUser ) {
				throw new Error( 'The login window was closed before sign-in completed.' );
			}
			const account = accountFromCookies( await collectSessionCookies( authSession ) );
			if ( account && ( await sessionWorksOnWordPressOrg( authSession ) ) ) {
				await saveStorageState( authSession );
				return account;
			}
			await delay( LOGIN_POLL_MS );
		}
		throw new Error( 'Timed out waiting for the WordPress.org login to complete.' );
	} finally {
		if ( ! loginWindow.isDestroyed() ) {
			loginWindow.close();
		}
	}
}

export async function logoutFromWordPressOrg(): Promise< void > {
	await getWordPressOrgSession().clearStorageData( { storages: [ 'cookies' ] } );
	const lockPath = getWordPressOrgStorageStateLockFilePath();
	await lockFileAsync( lockPath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
	try {
		await fs.rm( getWordPressOrgStorageStatePath(), { force: true } );
	} finally {
		await unlockFileAsync( lockPath );
	}
}
