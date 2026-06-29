import {
	BrowserWindow,
	session,
	type Cookie,
	type IpcMainInvokeEvent,
	type Session,
} from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import {
	getWordPressOrgStorageStateLockFilePath,
	getWordPressOrgStorageStatePath,
} from '@studio/common/lib/well-known-paths';
import { writeFile } from 'atomically';
import { WORDPRESS_ORG_AUTH_SESSION_PARTITION, WORDPRESS_ORG_LOGIN_URL } from 'src/constants';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import type { WordPressOrgAccount } from '@studio/common/types/publishing';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_MS = 1000;
const WORDPRESS_ORG_DEVELOPERS_ADD_URL = 'https://wordpress.org/plugins/developers/add/';
const WORDPRESS_ORG_LOGIN_REQUIRED_PATTERN =
	/please log in|log in to submit|before you can upload/i;
const WORDPRESS_ORG_SESSION_URLS = [
	'https://wordpress.org',
	'https://login.wordpress.org',
	'https://profiles.wordpress.org',
];

export function getWordPressOrgLoginUserAgent(): string {
	const platform =
		process.platform === 'darwin'
			? 'Macintosh; Intel Mac OS X 10_15_7'
			: process.platform === 'win32'
			? 'Windows NT 10.0; Win64; x64'
			: 'X11; Linux x86_64';

	return `Mozilla/5.0 (${ platform }) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ process.versions.chrome } Safari/537.36`;
}

type StorageStateCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: 'Strict' | 'Lax' | 'None';
};

type WordPressOrgStorageState = {
	cookies: StorageStateCookie[];
	origins: [];
};

function delay( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

function safeDecodeURIComponent( value: string ): string {
	try {
		return decodeURIComponent( value );
	} catch {
		return value;
	}
}

function usernameFromLoggedInCookieValue( value: string ): string | undefined {
	const decoded = safeDecodeURIComponent( value );
	const rawUsername = decoded.split( '|' )[ 0 ];
	return rawUsername || undefined;
}

function usernameFromProfileUrl( profileUrl: string ): string | undefined {
	try {
		const url = new URL( profileUrl );
		if ( url.hostname !== 'profiles.wordpress.org' ) {
			return undefined;
		}

		const username = url.pathname.split( '/' ).filter( Boolean )[ 0 ];
		return username && username !== 'me' ? username : undefined;
	} catch {
		return undefined;
	}
}

function accountFromProfileUrl( profileUrl: string ): WordPressOrgAccount | undefined {
	const username = usernameFromProfileUrl( profileUrl );
	return username ? { username, profileUrl } : undefined;
}

function accountFromLoggedInText( text: string ): WordPressOrgAccount | undefined {
	const normalized = text.replace( /\s+/g, ' ' );
	const match = normalized.match(
		/\b(?:Logged in (?:user|as)|You are logged in as):?\s*([A-Za-z0-9_.@-]+)/i
	);
	const username = match?.[ 1 ];

	return username
		? {
				username,
				profileUrl: `https://profiles.wordpress.org/${ username }/`,
		  }
		: undefined;
}

function isWordPressOrgDomain( domain: string | undefined ): boolean {
	const normalizedDomain = domain?.toLowerCase().replace( /^\./, '' );
	return (
		normalizedDomain === 'wordpress.org' || normalizedDomain?.endsWith( '.wordpress.org' ) || false
	);
}

function accountFromCookies( cookies: Array< Pick< Cookie, 'domain' | 'name' | 'value' > > ) {
	const loggedInCookie = cookies.find(
		( cookie ) => isWordPressOrgDomain( cookie.domain ) && /logged_in/i.test( cookie.name )
	);
	const username = loggedInCookie
		? usernameFromLoggedInCookieValue( loggedInCookie.value )
		: undefined;

	return username
		? {
				username,
				profileUrl: `https://profiles.wordpress.org/${ username }/`,
		  }
		: undefined;
}

function mapSameSite( sameSite: Cookie[ 'sameSite' ] ): StorageStateCookie[ 'sameSite' ] {
	if ( sameSite === 'strict' ) {
		return 'Strict';
	}
	if ( sameSite === 'no_restriction' ) {
		return 'None';
	}
	return 'Lax';
}

function cookieToStorageStateCookie( cookie: Cookie ): StorageStateCookie | undefined {
	if ( ! cookie.domain || ! cookie.path ) {
		return undefined;
	}

	return {
		name: cookie.name,
		value: cookie.value,
		domain: cookie.domain,
		path: cookie.path,
		expires: cookie.expirationDate ?? -1,
		httpOnly: cookie.httpOnly ?? false,
		secure: cookie.secure ?? false,
		sameSite: mapSameSite( cookie.sameSite ),
	};
}

function isWordPressOrgCookie( cookie: Cookie ): boolean {
	return isWordPressOrgDomain( cookie.domain );
}

function getWordPressOrgSession(): Session {
	return session.fromPartition( WORDPRESS_ORG_AUTH_SESSION_PARTITION );
}

async function getWordPressOrgCookies( authSession: Session ): Promise< Cookie[] > {
	const cookies = await Promise.all(
		WORDPRESS_ORG_SESSION_URLS.map( ( url ) => authSession.cookies.get( { url } ) )
	);
	const uniqueCookies = new Map< string, Cookie >();

	for ( const cookie of cookies.flat() ) {
		uniqueCookies.set( `${ cookie.domain }:${ cookie.path }:${ cookie.name }`, cookie );
	}

	return Array.from( uniqueCookies.values() );
}

async function accountFromSession(
	authSession: Session
): Promise< WordPressOrgAccount | undefined > {
	return accountFromCookies( await getWordPressOrgCookies( authSession ) );
}

async function accountFromCurrentPageProfileLink(
	loginWindow: BrowserWindow
): Promise< WordPressOrgAccount | undefined > {
	const profileUrl = await loginWindow.webContents
		.executeJavaScript(
			`
			Array.from( document.querySelectorAll( 'a[href*="profiles.wordpress.org/"]' ) )
				.map( ( link ) => link.href )
				.find( ( href ) => {
					try {
						const url = new URL( href );
						const username = url.pathname.split( '/' ).filter( Boolean )[ 0 ];
						return username && username !== 'me';
					} catch {
						return false;
					}
				} )
			`,
			true
		)
		.catch( () => undefined );

	return typeof profileUrl === 'string' ? accountFromProfileUrl( profileUrl ) : undefined;
}

async function accountFromCurrentPageText(
	loginWindow: BrowserWindow
): Promise< WordPressOrgAccount | undefined > {
	const pageText = await loginWindow.webContents
		.executeJavaScript( 'document.body?.innerText ?? ""', true )
		.catch( () => '' );

	return typeof pageText === 'string' ? accountFromLoggedInText( pageText ) : undefined;
}

async function sessionWorksOnWordPressOrg( authSession: Session ): Promise< boolean > {
	const verificationWindow = new BrowserWindow( {
		show: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			session: authSession,
		},
	} );
	verificationWindow.webContents.setUserAgent( getWordPressOrgLoginUserAgent() );
	verificationWindow.webContents.setWindowOpenHandler( () => ( { action: 'deny' } ) );

	try {
		await verificationWindow.loadURL( WORDPRESS_ORG_DEVELOPERS_ADD_URL );
		const bodyText = await verificationWindow.webContents.executeJavaScript(
			'document.body?.innerText ?? ""',
			true
		);
		return typeof bodyText === 'string' && ! WORDPRESS_ORG_LOGIN_REQUIRED_PATTERN.test( bodyText );
	} catch {
		return false;
	} finally {
		if ( ! verificationWindow.isDestroyed() ) {
			verificationWindow.close();
		}
	}
}

async function waitForLoggedInAccount(
	loginWindow: BrowserWindow,
	authSession: Session
): Promise< WordPressOrgAccount > {
	const deadline = Date.now() + LOGIN_TIMEOUT_MS;

	while ( Date.now() < deadline ) {
		if ( loginWindow.isDestroyed() ) {
			throw new Error( 'WordPress.org login was closed before it completed.' );
		}

		const cookieAccount = await accountFromSession( authSession );
		const linkAccount = await accountFromCurrentPageProfileLink( loginWindow );
		const textAccount = await accountFromCurrentPageText( loginWindow );
		const account = cookieAccount ?? linkAccount ?? textAccount;
		if ( account && ( await sessionWorksOnWordPressOrg( authSession ) ) ) {
			return account;
		}

		await delay( LOGIN_POLL_MS );
	}

	throw new Error( 'Timed out waiting for WordPress.org login.' );
}

async function lockWordPressOrgStorageState(): Promise< void > {
	const lockFilePath = getWordPressOrgStorageStateLockFilePath();
	await fs.mkdir( path.dirname( lockFilePath ), { recursive: true } );
	await lockFileAsync( lockFilePath, {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
}

async function unlockWordPressOrgStorageState(): Promise< void > {
	await unlockFileAsync( getWordPressOrgStorageStateLockFilePath() );
}

async function saveWordPressOrgStorageState( authSession: Session ): Promise< string > {
	const storageStatePath = getWordPressOrgStorageStatePath();
	const cookies = ( await getWordPressOrgCookies( authSession ) )
		.filter( isWordPressOrgCookie )
		.map( cookieToStorageStateCookie )
		.filter( ( cookie ): cookie is StorageStateCookie => Boolean( cookie ) );
	const storageState: WordPressOrgStorageState = {
		cookies,
		origins: [],
	};

	await lockWordPressOrgStorageState();
	try {
		await fs.mkdir( path.dirname( storageStatePath ), { recursive: true } );
		await writeFile( storageStatePath, JSON.stringify( storageState, null, 2 ) + '\n', {
			encoding: 'utf8',
		} );
	} finally {
		await unlockWordPressOrgStorageState();
	}

	return storageStatePath;
}

async function getAccountFromSavedStorageState(): Promise< WordPressOrgAccount | undefined > {
	try {
		const storageState = JSON.parse(
			await fs.readFile( getWordPressOrgStorageStatePath(), 'utf8' )
		) as Partial< WordPressOrgStorageState >;
		return accountFromCookies( storageState.cookies ?? [] );
	} catch {
		return undefined;
	}
}

function shouldKeepInLoginWindow( url: string ): boolean {
	try {
		const { hostname } = new URL( url );
		return hostname === 'wordpress.org' || hostname.endsWith( '.wordpress.org' );
	} catch {
		return false;
	}
}

export async function getSavedWordPressOrgAccount(): Promise< WordPressOrgAccount | undefined > {
	const sessionAccount = await accountFromSession( getWordPressOrgSession() ).catch(
		() => undefined
	);
	return sessionAccount ?? getAccountFromSavedStorageState();
}

export async function startWordPressOrgLogin(
	event: IpcMainInvokeEvent
): Promise< WordPressOrgAccount > {
	const authSession = getWordPressOrgSession();
	await authSession.clearStorageData( { storages: [ 'cookies' ] } );

	const parentWindow = BrowserWindow.fromWebContents( event.sender ) ?? undefined;
	const loginWindow = new BrowserWindow( {
		width: 720,
		height: 760,
		parent: parentWindow,
		title: 'Log in to WordPress.org',
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			session: authSession,
		},
	} );
	loginWindow.webContents.setUserAgent( getWordPressOrgLoginUserAgent() );

	loginWindow.webContents.setWindowOpenHandler( ( { url } ) => {
		if ( shouldKeepInLoginWindow( url ) ) {
			void loginWindow.loadURL( url );
		} else {
			void shellOpenExternalWrapper( url );
		}

		return { action: 'deny' };
	} );

	try {
		await loginWindow.loadURL( WORDPRESS_ORG_LOGIN_URL );
		const account = await waitForLoggedInAccount( loginWindow, authSession );
		await saveWordPressOrgStorageState( authSession );
		return account;
	} finally {
		if ( ! loginWindow.isDestroyed() ) {
			loginWindow.close();
		}
	}
}

export async function clearWordPressOrgLogin(): Promise< void > {
	const authSession = getWordPressOrgSession();
	await authSession.clearStorageData( { storages: [ 'cookies' ] } );

	await lockWordPressOrgStorageState();
	try {
		await fs.rm( getWordPressOrgStorageStatePath(), { force: true } );
	} finally {
		await unlockWordPressOrgStorageState();
	}
}
