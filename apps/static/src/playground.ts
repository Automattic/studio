import { INSPECTOR_BRIDGE_PREFIX } from '@studio/agent/protocol/inspector/page-script';
import { phpQuote } from './php';
import { kvGet, kvSet } from './store';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';
import type { BlueprintBundle, PlaygroundClient } from '@wp-playground/client';

// Each site runs in WordPress Playground: a `remote.html` iframe boots PHP and
// WordPress in a worker, and its service worker serves the site under
// `<site origin>/scope:<scope>/`. Any other iframe on this page can load that
// URL while the remote iframe is alive, so the preview is a plain iframe.
// Files persist in Playground's origin-private file system (OPFS).
const PLAYGROUND_REMOTE_URL =
	import.meta.env.VITE_PLAYGROUND_REMOTE_URL ?? 'https://playground.wordpress.net/remote.html';
// The client comes from the same deployment as remote.html, which
// playground.wordpress.net updates several times a day, so the two always match.
const PLAYGROUND_CLIENT_URL = new URL( '/client/index.js', PLAYGROUND_REMOTE_URL ).href;

type PlaygroundClientModule = typeof import('@wp-playground/client');
let clientModule: Promise< PlaygroundClientModule > | undefined;

// Loaded on first use, when a site starts or a Blueprint bundle is read.
export function loadPlaygroundClient(): Promise< PlaygroundClientModule > {
	clientModule ??= import(
		/* @vite-ignore */ PLAYGROUND_CLIENT_URL
	) as Promise< PlaygroundClientModule >;
	return clientModule;
}

// Sites are served from an origin of their own (wpsandbox.wordpress.net for
// playground.wordpress.net), which a booted site reports. It's kept for the
// URLs of sites that aren't running.
const SITE_ORIGIN_KEY = 'site-origin';
let siteOrigin = new URL( PLAYGROUND_REMOTE_URL ).origin;

export async function loadSiteOrigin(): Promise< void > {
	siteOrigin = ( await kvGet< string >( SITE_ORIGIN_KEY ) ) ?? siteOrigin;
}

export function getSiteOrigin(): string {
	return siteOrigin;
}

async function rememberSiteOrigin( client: PlaygroundClient ): Promise< void > {
	const origin = new URL( await client.absoluteUrl ).origin;
	if ( origin !== siteOrigin ) {
		siteOrigin = origin;
		await kvSet( SITE_ORIGIN_KEY, origin );
	}
}
const DOCROOT = '/wordpress';
const BRIDGE_PATH = '/internal/shared/mu-plugins/studio-bridge.php';
const SCREENSHOT_LIBRARY = 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.6.0/+esm';

export interface SiteRuntimeConfig {
	id: string;
	scope: string;
	phpVersion: string;
	wpVersion: string;
}

export interface FreshSiteOptions {
	siteName: string;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	blueprint?: BlueprintV1Declaration;
	// The files a Blueprint bundle's steps reference, beside its blueprint.json.
	bundle?: BlueprintBundle;
}

// A Blueprint bundle from a .zip (blueprint.json at its root or in its one
// folder) or a URL.
export function loadBlueprintBundle( source: Blob | string ): Promise< BlueprintBundle > {
	const url = typeof source === 'string' ? source : URL.createObjectURL( source );
	return loadPlaygroundClient()
		.then( ( playground ) => playground.resolveRemoteBlueprint( url ) )
		.finally( () => {
			if ( typeof source !== 'string' ) {
				URL.revokeObjectURL( url );
			}
		} );
}

// The bundle's files with another blueprint.json, of which Playground reads
// only the text.
function withDeclaration(
	bundle: BlueprintBundle,
	declaration: BlueprintV1Declaration
): BlueprintBundle {
	const json = new File( [ JSON.stringify( declaration ) ], 'blueprint.json', {
		type: 'application/json',
	} );
	return {
		read: ( path: string ) =>
			path.replace( /^\/+/, '' ) === 'blueprint.json'
				? Promise.resolve( json as Awaited< ReturnType< BlueprintBundle[ 'read' ] > > )
				: bundle.read( path ),
	};
}

export function getSiteUrl( scope: string ): string {
	return `${ siteOrigin }/scope:${ scope }`;
}

function getOpfsPath( id: string ): string {
	return `studio/sites/${ id }`;
}

// Runs inside every WordPress page of a site, serialized into the bridge
// mu-plugin, so it must be self-contained. Studio pages ask it to capture the
// page or to run a page script (see site-page.ts); it answers only this app.
function pageBridge( appOrigin: string, screenshotLibrary: string, consolePrefix: string ) {
	if ( window.parent === window ) {
		return;
	}
	const post = ( message: unknown ) => window.parent.postMessage( message, appOrigin );
	// The annotation inspector talks to its host through the console.
	const log = console.log.bind( console );
	console.log = ( ...args: unknown[] ) => {
		if ( typeof args[ 0 ] === 'string' && args[ 0 ].startsWith( consolePrefix ) ) {
			post( { type: 'studio:console', message: args[ 0 ] } );
			return;
		}
		log( ...args );
	};
	// Emulates prefers-color-scheme by switching the page's color-scheme media
	// rules on or off.
	const applyColorScheme = ( scheme: unknown ) => {
		if ( scheme !== 'light' && scheme !== 'dark' ) {
			return;
		}
		const visit = ( rules: CSSRuleList ) => {
			for ( const rule of Array.from( rules ) ) {
				if (
					rule instanceof CSSMediaRule &&
					rule.media.mediaText.includes( 'prefers-color-scheme' )
				) {
					rule.media.mediaText = rule.media.mediaText.replace(
						/\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/g,
						( _match, value: string ) => ( value === scheme ? 'all' : 'not all' )
					);
				}
				if ( 'cssRules' in rule ) {
					visit( ( rule as CSSGroupingRule ).cssRules );
				}
			}
		};
		for ( const sheet of Array.from( document.styleSheets ) ) {
			try {
				visit( sheet.cssRules );
			} catch {
				// A cross-origin stylesheet keeps its rules to itself.
			}
		}
		document.documentElement.style.colorScheme = scheme;
	};
	const actions: Record< string, ( payload: Record< string, unknown > ) => Promise< unknown > > = {
		async capture( payload ) {
			// Built with Function so bundlers leave this runtime import alone.
			const load = new Function( 'url', 'return import( url )' ) as (
				url: string
			) => Promise< { domToJpeg( node: Element, options: object ): Promise< string > } >;
			const lib = await load( screenshotLibrary );
			const root = document.documentElement;
			const pageHeight = Math.max( root.scrollHeight, document.body?.scrollHeight ?? 0 );
			const offset = Math.min( Number( payload.offset ?? 0 ), Math.max( 0, pageHeight - 1 ) );
			const height = Math.min(
				pageHeight - offset,
				payload.maxHeight ? Number( payload.maxHeight ) : window.innerHeight
			);
			const dataUrl = await lib.domToJpeg( root, {
				quality: 0.85,
				width: window.innerWidth,
				height,
				backgroundColor: '#ffffff',
				...( offset ? { style: { transform: `translateY(-${ offset }px)` } } : {} ),
			} );
			return { dataUrl, pageHeight, offset, height };
		},
		async evaluate( payload ) {
			const run = new Function( `return (${ String( payload.source ) })` )() as (
				...args: unknown[]
			) => unknown;
			return run( ...( ( payload.args as unknown[] ) ?? [] ) );
		},
		async run( payload ) {
			new Function( String( payload.source ) )();
			return true;
		},
		async 'color-scheme'( payload ) {
			applyColorScheme( payload.scheme );
			return true;
		},
		async 'wait-for'( payload ) {
			const deadline = Date.now() + Number( payload.timeoutMs ?? 30_000 );
			const ready = new Function( `return (${ String( payload.source ) })` )() as () => boolean;
			while ( ! ready() ) {
				if ( Date.now() > deadline ) {
					throw new Error( 'The page did not get ready in time.' );
				}
				await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
			}
			return true;
		},
	};
	const actionsByName = new Map( Object.entries( actions ) );
	window.addEventListener( 'message', ( event: MessageEvent ) => {
		const data = event.data as {
			type?: string;
			id?: string;
			action?: string;
			payload?: Record< string, unknown >;
		};
		if ( event.origin !== appOrigin || data?.type !== 'studio:request' || ! data.action ) {
			return;
		}
		const action = actionsByName.get( data.action );
		const reply = ( message: Record< string, unknown > ) =>
			( event.source as Window ).postMessage(
				{ type: 'studio:response', id: data.id, ...message },
				appOrigin
			);
		if ( ! action ) {
			reply( { error: `Unknown action ${ data.action }` } );
			return;
		}
		action( data.payload ?? {} ).then(
			( result ) => reply( { result } ),
			( error: unknown ) => reply( { error: String( ( error as Error )?.message ?? error ) } )
		);
	} );
	const announce = () =>
		post( { type: 'studio:loaded', href: location.href, title: document.title } );
	if ( document.readyState === 'complete' ) {
		announce();
	} else {
		window.addEventListener( 'load', announce );
	}
}

// The bridge script a page answers this app's requests with.
export function buildBridgeScript( appOrigin: string ): string {
	return `(${ pageBridge.toString() })(${ [ appOrigin, SCREENSHOT_LIBRARY, INSPECTOR_BRIDGE_PREFIX ]
		.map( ( arg ) => JSON.stringify( arg ) )
		.join( ', ' ) });`;
}

function buildBridgePlugin( appOrigin: string ): string {
	const script = buildBridgeScript( appOrigin );
	return `<?php
function studio_bridge_script() {
	echo '<script>' . ${ phpQuote( script ) } . '</script>';
}
add_action( 'wp_footer', 'studio_bridge_script', 999 );
add_action( 'admin_footer', 'studio_bridge_script', 999 );
add_action( 'login_footer', 'studio_bridge_script', 999 );
// The preview opens admin screens through Studio's auto-login route.
add_action( 'init', function () {
	$path = (string) parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	if ( ! preg_match( '#/studio-auto-login/?$#', $path ) ) {
		return;
	}
	if ( ! is_user_logged_in() ) {
		wp_set_current_user( 1 );
		wp_set_auth_cookie( 1, true );
	}
	wp_safe_redirect( isset( $_GET['redirect_to'] ) ? wp_unslash( $_GET['redirect_to'] ) : admin_url() );
	exit;
} );
`;
}

interface Runtime {
	iframe: HTMLIFrameElement;
	client: Promise< PlaygroundClient >;
	// Set once WordPress answers requests: the preview must not load before.
	ready: boolean;
}

export class PlaygroundRuntimes {
	private readonly runtimes = new Map< string, Runtime >();
	private container: HTMLElement | undefined;

	isRunning( id: string ): boolean {
		return this.runtimes.get( id )?.ready ?? false;
	}

	// The remote iframes stay attached for as long as their site runs, but out
	// of sight: the user sees the site through the preview's own iframe.
	private getContainer(): HTMLElement {
		if ( ! this.container ) {
			this.container = document.createElement( 'div' );
			this.container.setAttribute( 'aria-hidden', 'true' );
			this.container.style.cssText =
				'position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
			document.body.appendChild( this.container );
		}
		return this.container;
	}

	// Boots a site whose files are already in OPFS.
	start( config: SiteRuntimeConfig ): Promise< PlaygroundClient > {
		return this.boot( config, async ( iframe ) =>
			( await loadPlaygroundClient() ).startPlaygroundWeb( {
				iframe,
				remoteUrl: PLAYGROUND_REMOTE_URL,
				scope: config.scope,
				disableProgressBar: true,
				mounts: [
					{
						mountpoint: DOCROOT,
						device: { type: 'opfs', path: getOpfsPath( config.id ) },
						initialSyncDirection: 'opfs-to-memfs',
					},
				],
				wordpressInstallMode: 'install-from-existing-files-if-needed',
				blueprint: {
					preferredVersions: { php: config.phpVersion as never, wp: config.wpVersion },
					features: { networking: true },
					login: true,
				},
			} )
		);
	}

	// Installs a new site, runs its Blueprint, then saves its files to OPFS.
	create( config: SiteRuntimeConfig, options: FreshSiteOptions ): Promise< PlaygroundClient > {
		return this.boot( config, async ( iframe ) => {
			const blueprint = options.blueprint ?? {};
			const declaration: BlueprintV1Declaration = {
				...blueprint,
				preferredVersions: { php: config.phpVersion as never, wp: config.wpVersion },
				features: { networking: true, ...blueprint.features },
				login: true,
				steps: [
					{ step: 'setSiteOptions', options: { blogname: options.siteName } },
					...( blueprint.steps ?? [] ),
					...adminAccountSteps( options ),
				],
			};
			const client = await (
				await loadPlaygroundClient()
			).startPlaygroundWeb( {
				iframe,
				remoteUrl: PLAYGROUND_REMOTE_URL,
				scope: config.scope,
				disableProgressBar: true,
				blueprint: options.bundle ? withDeclaration( options.bundle, declaration ) : declaration,
			} );
			await client.mountOpfs( {
				mountpoint: DOCROOT,
				device: { type: 'opfs', path: getOpfsPath( config.id ) },
				initialSyncDirection: 'memfs-to-opfs',
			} );
			return client;
		} );
	}

	private boot(
		config: SiteRuntimeConfig,
		startClient: ( iframe: HTMLIFrameElement ) => Promise< PlaygroundClient >
	): Promise< PlaygroundClient > {
		const existing = this.runtimes.get( config.id );
		if ( existing ) {
			return existing.client;
		}
		const iframe = document.createElement( 'iframe' );
		iframe.title = config.scope;
		iframe.style.cssText = 'width:1280px;height:800px;border:0;';
		this.getContainer().appendChild( iframe );
		const client = startClient( iframe ).then( async ( playground ) => {
			await rememberSiteOrigin( playground );
			await playground.writeFile( BRIDGE_PATH, buildBridgePlugin( window.location.origin ) );
			return playground;
		} );
		const runtime: Runtime = { iframe, client, ready: false };
		this.runtimes.set( config.id, runtime );
		client.then(
			() => ( runtime.ready = true ),
			() => this.dispose( config.id )
		);
		return client;
	}

	client( id: string ): Promise< PlaygroundClient > | undefined {
		return this.runtimes.get( id )?.client;
	}

	async stop( id: string ): Promise< void > {
		const runtime = this.runtimes.get( id );
		if ( ! runtime ) {
			return;
		}
		try {
			// Unmounting flushes the last file changes to OPFS.
			const client = await runtime.client;
			await client.unmountOpfs( DOCROOT );
		} catch {
			// A runtime that failed to boot has nothing to flush.
		}
		this.dispose( id );
	}

	private dispose( id: string ) {
		this.runtimes.get( id )?.iframe.remove();
		this.runtimes.delete( id );
	}
}

function adminAccountSteps(
	options: FreshSiteOptions
): BlueprintV1Declaration[ 'steps' ] & object {
	const { adminUsername, adminPassword, adminEmail } = options;
	if ( ! adminUsername && ! adminPassword && ! adminEmail ) {
		return [];
	}
	return [
		{
			step: 'runPHP',
			code: `<?php
require '/wordpress/wp-load.php';
$user = get_user_by( 'id', 1 );
global $wpdb;
${
	adminUsername
		? `$wpdb->update( $wpdb->users, array( 'user_login' => ${ phpQuote(
				adminUsername
		  ) }, 'user_nicename' => sanitize_title( ${ phpQuote(
				adminUsername
		  ) } ) ), array( 'ID' => 1 ) );`
		: ''
}
${ adminPassword ? `wp_set_password( ${ phpQuote( adminPassword ) }, 1 );` : '' }
${
	adminEmail
		? `wp_update_user( array( 'ID' => 1, 'user_email' => ${ phpQuote( adminEmail ) } ) );`
		: ''
}
clean_user_cache( 1 );
`,
		},
		{ step: 'login', username: adminUsername ?? 'admin', password: adminPassword ?? 'password' },
	];
}
