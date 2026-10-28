import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { syncOptionSchema, type SyncOption, SyncSite } from '@studio/common/types/sync';
import { posix } from 'pathe';
import { getSiteUrl, loadPlaygroundClient } from '../playground';
import { exportDatabaseSql, exportSiteZip } from '../site-data';
import { openSitePage, type SitePage } from '../site-page';
import type { StaticSiteRecord, StaticSites } from '../sites';
import type { WpcomAuth } from '../wpcom-auth';
import type { WpcomServices } from '../wpcom-services';
import type {
	HostFiles,
	HostPage,
	HostPages,
	HostPath,
	HostSite,
	StudioAgentHost,
} from '@studio/agent/browser';
import type { PlaygroundClient } from '@wp-playground/client';

// Inside a site's runtime, `/sites/<slug>` is `/wordpress`.
const DOCROOT = '/wordpress';
const WP_CLI_PATH = '/tmp/wp-cli.phar';
const SITES_ROOT = '/sites';
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
const MAX_CAPTURE_HEIGHT = 8000;

const path: HostPath = {
	join: posix.join,
	resolve: ( ...paths ) => posix.resolve( '/', ...paths ),
	relative: posix.relative,
	dirname: posix.dirname,
	basename: posix.basename,
	extname: posix.extname,
	isAbsolute: posix.isAbsolute,
	sep: '/',
	fileURLToPath: ( url ) => decodeURIComponent( new URL( url ).pathname ),
	pathToFileURL: ( file ) => `file://${ encodeURI( file ) }`,
};

function phpQuote( value: string ): string {
	return `'${ value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" ) }'`;
}

function normalizeHostname( value: string ): string {
	return value
		.trim()
		.replace( /^https?:\/\//, '' )
		.replace( /\/.*$/, '' );
}

function parseSyncOptions( value: string ): SyncOption[] {
	return value.split( ',' ).map( ( option ) => {
		const parsed = syncOptionSchema.safeParse( option.trim() );
		if ( ! parsed.success ) {
			throw new Error(
				`Invalid sync option: ${ option.trim() }. Valid options: ${ syncOptionSchema.options.join(
					', '
				) }`
			);
		}
		return parsed.data;
	} );
}

function bytesOfDataUrl( dataUrl: string ): Uint8Array {
	return Uint8Array.from( atob( dataUrl.slice( dataUrl.indexOf( ',' ) + 1 ) ), ( char ) =>
		char.charCodeAt( 0 )
	);
}

function dataUrlOf( bytes: Uint8Array, mimeType: string ): Promise< string > {
	return new Promise( ( resolve ) => {
		const reader = new FileReader();
		reader.onload = () => resolve( String( reader.result ) );
		reader.readAsDataURL( new Blob( [ bytes as BlobPart ], { type: mimeType } ) );
	} );
}

// wp-cli.phar lives in the runtime's /tmp, which a restart empties.
const wpCliReady = new WeakMap< PlaygroundClient, Promise< void > >();
let wpCliPhar: Promise< Uint8Array > | undefined;
function ensureWpCli( client: PlaygroundClient ): Promise< void > {
	let ready = wpCliReady.get( client );
	if ( ! ready ) {
		ready = ( async () => {
			if ( await client.fileExists( WP_CLI_PATH ) ) {
				return;
			}
			wpCliPhar ??= loadPlaygroundClient()
				.then( ( playground ) =>
					fetch( ( playground.defaultWpCliResource as { url: string } ).url )
				)
				.then( async ( response ) => {
					if ( ! response.ok ) {
						throw new Error( 'WP-CLI could not be downloaded.' );
					}
					return new Uint8Array( await response.arrayBuffer() );
				} );
			await client.writeFile( WP_CLI_PATH, await wpCliPhar );
		} )();
		ready.catch( () => wpCliReady.delete( client ) );
		wpCliReady.set( client, ready );
	}
	return ready;
}

// Browsers cannot put an element in :hover from a script, so the stylesheet's
// :hover rules are copied onto an attribute set on the element and its ancestors.
function hoverScript( selector: string | null ) {
	document.getElementById( 'studio-hover' )?.remove();
	document
		.querySelectorAll( '[data-studio-hover]' )
		.forEach( ( element ) => element.removeAttribute( 'data-studio-hover' ) );
	if ( ! selector ) {
		return;
	}
	const element = document.querySelector( selector );
	if ( ! element ) {
		throw new Error( `No element matches ${ selector }` );
	}
	for ( let node: Element | null = element; node; node = node.parentElement ) {
		node.setAttribute( 'data-studio-hover', '' );
	}
	const css: string[] = [];
	const collect = ( list: CSSRuleList ) => {
		for ( const rule of Array.from( list ) ) {
			if ( rule instanceof CSSStyleRule && rule.selectorText.includes( ':hover' ) ) {
				css.push(
					`${ rule.selectorText.replace( /:hover/g, '[data-studio-hover]' ) } { ${
						rule.style.cssText
					} }`
				);
			} else if ( 'cssRules' in rule ) {
				collect( ( rule as CSSGroupingRule ).cssRules );
			}
		}
	};
	for ( const sheet of Array.from( document.styleSheets ) ) {
		try {
			collect( sheet.cssRules );
		} catch {
			// A cross-origin stylesheet keeps its rules to itself.
		}
	}
	const style = document.createElement( 'style' );
	style.id = 'studio-hover';
	style.textContent = css.join( '\n' );
	document.head.appendChild( style );
}

function navigationStatusScript() {
	const entry = performance.getEntriesByType( 'navigation' )[ 0 ] as
		| ( PerformanceEntry & { responseStatus?: number } )
		| undefined;
	return entry?.responseStatus ?? 200;
}

function toHostPage( page: SitePage, url: string, status: number ): HostPage {
	let closed = false;
	return {
		evaluate: ( script: ( arg?: unknown ) => unknown, arg?: unknown ) =>
			arg === undefined ? page.evaluate( script ) : page.evaluate( script, arg ),
		waitFor: ( condition, timeoutMs ) => page.waitFor( condition, timeoutMs ),
		hover: async ( selector ) => {
			await page.evaluate( hoverScript, selector );
		},
		// The page bridge captures JPEGs, from `clip.y` down.
		screenshot: async ( { fullPage, clip } ) => {
			const capture = await page.capture( {
				offset: clip?.y ?? 0,
				maxHeight: clip?.height ?? ( fullPage ? MAX_CAPTURE_HEIGHT : undefined ),
			} );
			return bytesOfDataUrl( capture.dataUrl );
		},
		url: () => url,
		status: () => status,
		isClosed: () => closed,
		close: async () => {
			closed = true;
			page.close();
		},
	} as HostPage;
}

/**
 * The agent's host in Studio on the web: sites run in Playground, their files
 * are the runtimes' files under `/sites/<slug>`, pages load in off-screen
 * frames, and WordPress.com requests go from the browser. Paths outside a site,
 * such as images the agent saved and files the user attached, live in memory
 * for as long as the page.
 */
export function createStaticAgentHost( deps: {
	sites: StaticSites;
	auth: WpcomAuth;
	wpcom: WpcomServices;
	// A file the user attached to the chat, by the path its prompt names.
	readAttachment( path: string ): File | undefined;
	// Saves a file to the user's computer through the browser.
	download( data: BlobPart, filename: string, type: string ): void;
} ): StudioAgentHost {
	const { sites, auth, wpcom } = deps;
	const memory = new Map< string, Uint8Array >();

	const hostSite = ( record: StaticSiteRecord ): HostSite => ( {
		id: record.id,
		name: record.name,
		path: record.path,
		url: getSiteUrl( record.scope ),
		phpVersion: record.phpVersion,
		adminPassword: record.adminPassword,
	} );

	async function findSite( nameOrPath: string ): Promise< StaticSiteRecord > {
		const records = await sites.list();
		const needle = nameOrPath.trim().replace( /\/+$/, '' );
		const site =
			records.find( ( record ) => record.path === needle || record.id === needle ) ??
			records.find( ( record ) => needle.startsWith( `${ record.path }/` ) ) ??
			records.find( ( record ) => record.name.toLowerCase() === needle.toLowerCase() ) ??
			records.find( ( record ) => needle.startsWith( getSiteUrl( record.scope ) ) );
		if ( ! site ) {
			throw new Error(
				`No site matches "${ nameOrPath }". Sites: ${
					records.map( ( record ) => `${ record.name } (${ record.path })` ).join( ', ' ) || 'none'
				}`
			);
		}
		return site;
	}

	// The site a path is in and the path in its runtime, or nothing for a path
	// outside every site.
	async function locate( file: string ) {
		const normalized = path.resolve( file );
		const site = ( await sites.list() ).find(
			( record ) => normalized === record.path || normalized.startsWith( `${ record.path }/` )
		);
		if ( ! site ) {
			return undefined;
		}
		return {
			site,
			client: await sites.client( site.id ),
			fsPath: `${ DOCROOT }${ normalized.slice( site.path.length ) }` || DOCROOT,
		};
	}

	const fromMemory = ( file: string ) => {
		const attachment = deps.readAttachment( file );
		if ( attachment ) {
			return attachment.arrayBuffer().then( ( buffer ) => new Uint8Array( buffer ) );
		}
		const bytes = memory.get( path.resolve( file ) );
		if ( ! bytes ) {
			throw new Error( `${ file } does not exist.` );
		}
		return Promise.resolve( bytes );
	};

	const files: HostFiles = {
		read: async ( file ) => {
			const located = await locate( file );
			return located ? located.client.readFileAsBuffer( located.fsPath ) : fromMemory( file );
		},
		readText: async ( file ) => new TextDecoder().decode( await files.read( file ) ),
		write: async ( file, data ) => {
			const located = await locate( file );
			if ( ! located ) {
				memory.set(
					path.resolve( file ),
					typeof data === 'string' ? new TextEncoder().encode( data ) : data
				);
				return;
			}
			await located.client.mkdirTree( path.dirname( located.fsPath ) );
			await located.client.writeFile( located.fsPath, data );
		},
		exists: async ( file ) => {
			const located = await locate( file );
			return located
				? located.client.fileExists( located.fsPath )
				: memory.has( path.resolve( file ) ) || Boolean( deps.readAttachment( file ) );
		},
		isDirectory: async ( file ) => {
			const located = await locate( file );
			if ( located ) {
				return located.client.isDir( located.fsPath );
			}
			const prefix = `${ path.resolve( file ).replace( /\/$/, '' ) }/`;
			return (
				path.resolve( file ) === SITES_ROOT ||
				[ ...memory.keys() ].some( ( key ) => key.startsWith( prefix ) )
			);
		},
		mkdir: async ( directory ) => {
			const located = await locate( directory );
			await located?.client.mkdirTree( located.fsPath );
		},
		list: async ( directory ) => {
			const located = await locate( directory );
			if ( ! located ) {
				if ( path.resolve( directory ) === SITES_ROOT ) {
					return ( await sites.list() ).map( ( record ) => ( {
						name: path.basename( record.path ),
						directory: true,
					} ) );
				}
				const prefix = `${ path.resolve( directory ).replace( /\/$/, '' ) }/`;
				const names = new Map< string, boolean >();
				for ( const key of memory.keys() ) {
					if ( key.startsWith( prefix ) ) {
						const [ name, ...rest ] = key.slice( prefix.length ).split( '/' );
						names.set( name, rest.length > 0 );
					}
				}
				return [ ...names ].map( ( [ name, isDirectory ] ) => ( {
					name,
					directory: isDirectory,
				} ) );
			}
			const { client, fsPath } = located;
			return Promise.all(
				( await client.listFiles( fsPath ) ).map( async ( name ) => ( {
					name,
					directory: await client.isDir( `${ fsPath }/${ name }` ),
				} ) )
			);
		},
		// One PHP call instead of a request per folder.
		walk: async ( directory ) => {
			const located = await locate( directory );
			if ( ! located ) {
				const prefix = `${ path.resolve( directory ).replace( /\/$/, '' ) }/`;
				return [ ...memory.keys() ]
					.filter( ( key ) => key.startsWith( prefix ) )
					.map( ( key ) => key.slice( prefix.length ) );
			}
			const response = await located.client.run( {
				code: `<?php
$base = ${ phpQuote( located.fsPath ) };
$found = array();
$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $base, FilesystemIterator::SKIP_DOTS ) );
foreach ( $iterator as $file ) {
	$found[] = substr( $file->getPathname(), strlen( $base ) + 1 );
	if ( count( $found ) >= 50000 ) { break; }
}
echo implode( "\\n", $found );`,
			} );
			return response.text.split( '\n' ).filter( Boolean );
		},
		remove: async ( file ) => {
			const located = await locate( file );
			if ( ! located ) {
				memory.delete( path.resolve( file ) );
				return;
			}
			if ( await located.client.isDir( located.fsPath ) ) {
				await located.client.rmdir( located.fsPath, { recursive: true } );
			} else if ( await located.client.fileExists( located.fsPath ) ) {
				await located.client.unlink( located.fsPath );
			}
		},
	};

	// The site a URL points at, and its path there.
	async function pageOf( url: string ) {
		for ( const record of await sites.list() ) {
			const siteUrl = getSiteUrl( record.scope );
			if ( url === siteUrl || url.startsWith( `${ siteUrl }/` ) ) {
				return { record, sitePath: url.slice( siteUrl.length ) || '/' };
			}
		}
		throw new Error( `${ url } is not a page of a Studio site.` );
	}

	const pages: HostPages = {
		async open( target, options = {} ) {
			const size = { ...( options.viewport ?? {} ), settleMs: 600 };
			let page: SitePage;
			let url: string;
			if ( 'html' in target ) {
				page = await openSitePage( { html: target.html }, size );
				url = 'about:srcdoc';
			} else {
				const { record, sitePath } = await pageOf( target.url );
				await sites.start( record.id );
				url = target.url;
				const scopePath = new URL( getSiteUrl( record.scope ) ).pathname.replace( /\/$/, '' );
				page = await openSitePage(
					{
						scope: record.scope,
						path: target.signIn
							? `/studio-auto-login?redirect_to=${ encodeURIComponent( scopePath + sitePath ) }`
							: sitePath,
					},
					size
				);
			}
			if ( options.colorScheme ) {
				await page.setColorScheme( options.colorScheme );
			}
			if ( options.initScript ) {
				await page.evaluate( options.initScript );
			}
			const status = 'html' in target ? 0 : await page.evaluate( navigationStatusScript );
			return toHostPage( page, url, status );
		},
		async fetchText( url ) {
			const { record, sitePath } = await pageOf( url );
			const client = await sites.client( record.id );
			const response = await client.request( { url: sitePath } );
			return { status: response.httpStatusCode, body: response.text };
		},
	};

	async function findRemoteSite( site: HostSite, remoteSite: string | undefined ) {
		if ( ! ( await auth.token() ) ) {
			throw new Error(
				'This needs WordPress.com authentication: ask the user to log in to WordPress.com from Settings.'
			);
		}
		if ( ! remoteSite ) {
			const connected = await wpcom.getConnectedSites( site.id );
			if ( connected.length !== 1 ) {
				throw new Error( 'Name the WordPress.com site to sync with.' );
			}
			return connected[ 0 ];
		}
		const needle = remoteSite.trim();
		const host = normalizeHostname( needle );
		const remote = ( await wpcom.fetchSyncableSites() ).find(
			( candidate ) =>
				String( candidate.id ) === needle || normalizeHostname( candidate.url ) === host
		);
		if ( ! remote ) {
			throw new Error( `No WordPress.com site of the user matches "${ remoteSite }".` );
		}
		if ( remote.syncSupport !== 'syncable' && remote.syncSupport !== 'already-connected' ) {
			throw new Error( `"${ remote.name }" cannot be synced (${ remote.syncSupport }).` );
		}
		if (
			! ( await wpcom.getConnectedSites( site.id ) ).some( ( entry ) => entry.id === remote.id )
		) {
			await wpcom.connectSite( site.id, remote );
		}
		return remote;
	}

	async function snapshotsOf( site: HostSite ) {
		return ( await wpcom.getSnapshots() ).filter(
			( snapshot ) => snapshot.localSiteId === site.id
		);
	}

	return {
		sitesRoot: SITES_ROOT,
		userAgent: `WordPressStudio/web ${ navigator.userAgent }`,
		sites: {
			resolve: async ( nameOrPath ) => hostSite( await findSite( nameOrPath ) ),
			findByFolder: async ( folder ) => {
				const record = await sites.findByPath( folder );
				return record && hostSite( record );
			},
			all: async () => ( await sites.list() ).map( hostSite ),
			list: async () =>
				( await sites.list() ).map( ( record ) => {
					const { adminPassword: _password, ...details } = sites.toDetails( record );
					return {
						...details,
						url: getSiteUrl( record.scope ),
						running: sites.runtimes.isRunning( record.id ),
					};
				} ),
			status: async ( site ) => {
				const record = await sites.get( site.id );
				return {
					url: getSiteUrl( record.scope ),
					path: record.path,
					emailPath: '',
					running: sites.runtimes.isRunning( record.id ),
					phpVersion: record.phpVersion,
					wpVersion: record.wpVersion,
					fileAccess: 'site-directory',
					xdebug: false,
					adminUsername: record.adminUsername,
					adminEmail: record.adminEmail,
				};
			},
			create: async ( name, sitePath ) => {
				await sites.create( { name, path: sitePath } );
			},
			start: ( site ) => sites.start( site.id ),
			stop: ( site ) => sites.stop( site.id ),
			delete: ( site ) => sites.delete( site.id ),
			isRunning: async ( site ) => sites.runtimes.isRunning( site.id ),
			import: async ( site, file ) => {
				const bytes = await files.read( file );
				await sites.import( site.id, new File( [ bytes as BlobPart ], path.basename( file ) ) );
			},
			export: async ( site, file, mode ) => {
				const client = await sites.client( site.id );
				const name = path.basename( file );
				if ( mode === 'db' ) {
					deps.download( await exportDatabaseSql( client ), name, 'application/sql' );
				} else {
					deps.download( ( await exportSiteZip( client ) ) as BlobPart, name, 'application/zip' );
				}
			},
			wpCli: async ( site, args ) => {
				const client = await sites.client( site.id );
				await ensureWpCli( client );
				// Site paths map into the runtime; anything but a plain word is quoted.
				const command = args
					.map( ( arg ) => arg.split( site.path ).join( DOCROOT ) )
					.map( ( arg ) =>
						/^[\w@%+=:,./-]+$/.test( arg ) ? arg : `'${ arg.replace( /'/g, `'\\''` ) }'`
					)
					.join( ' ' );
				try {
					const response = await (
						await loadPlaygroundClient()
					).wpCLI( client, {
						command: `wp --path=${ DOCROOT } ${ command }`,
					} );
					return {
						exitCode: response.exitCode ?? 0,
						stdout: response.text.replace( /^#!.*\n/, '' ).replace( ANSI_ESCAPE, '' ),
						stderr: ( response.errors ?? '' ).replace( ANSI_ESCAPE, '' ),
					};
				} catch ( error ) {
					return {
						exitCode: 1,
						stdout: '',
						stderr: ( error instanceof Error ? error.message : String( error ) ).slice( 0, 4000 ),
					};
				}
			},
		},
		previews: {
			list: snapshotsOf,
			create: async ( site ) => {
				const { url } = await wpcom.publishPreview( site.id );
				const hostname = normalizeHostname( url );
				const snapshot = ( await snapshotsOf( site ) ).find( ( entry ) => entry.url === hostname );
				if ( ! snapshot ) {
					throw new Error( `The preview site ${ hostname } was not recorded.` );
				}
				return snapshot;
			},
			update: async ( site, hostname ) => {
				const host = normalizeHostname( hostname );
				const existing = ( await wpcom.getSnapshots() ).find( ( entry ) => entry.url === host );
				if ( ! existing ) {
					throw new Error( `No preview site "${ host }". List them with preview_list.` );
				}
				if ( isSnapshotExpired( existing ) ) {
					throw new Error( `The preview site "${ host }" has expired.` );
				}
				await wpcom.publishPreview( site.id, host );
				return ( await wpcom.getSnapshots() ).find( ( entry ) => entry.url === host ) ?? existing;
			},
			delete: ( hostname ) => wpcom.deleteSnapshot( normalizeHostname( hostname ) ),
		},
		sync: {
			push: async ( site, options, remoteSite ): Promise< SyncSite > => {
				const remote = await findRemoteSite( site, remoteSite );
				await wpcom.push( site.id, remote.id, { optionsToSync: parseSyncOptions( options ) } );
				return remote;
			},
			pull: async ( site, options, remoteSite ): Promise< SyncSite > => {
				const remote = await findRemoteSite( site, remoteSite );
				await wpcom.pull( site.id, remote.id, { optionsToSync: parseSyncOptions( options ) } );
				return remote;
			},
		},
		wpcom: {
			token: async () => ( await auth.token() )?.accessToken,
			imageToken: async () => ( await auth.token() )?.accessToken,
			sites: () => wpcom.fetchSyncableSites(),
			connectedSites: async ( site ) =>
				( await auth.token() ) ? wpcom.getConnectedSites( site.id ) : [],
			request: async ( method, requestPath, query, body ) => {
				const { apiNamespace, ...params } = query;
				const search = new URLSearchParams(
					Object.entries( params ).map( ( [ key, value ] ) => [
						key,
						typeof value === 'string' ? value : JSON.stringify( value ),
					] )
				).toString();
				const base = apiNamespace ? `/${ String( apiNamespace ) }` : '/rest/v1.1';
				return auth.request( `${ base }${ requestPath }${ search ? `?${ search }` : '' }`, {
					method,
					...( body ? { body: JSON.stringify( body ) } : {} ),
				} );
			},
			payloadsDirectory: '/payloads',
		},
		tracks: { record: async () => {} },
		path,
		files,
		pages,
		saveImage: async ( bytes, name, mimeType ) => {
			const file = `/images/${ name }`;
			memory.set( file, bytes );
			return { path: file, url: await dataUrlOf( bytes, mimeType ) };
		},
	};
}
