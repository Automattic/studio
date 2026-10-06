import type { DisplayMode, HostState, LocalSite, ToolResult, UserMessage } from './types';

// The MCP Apps bridge: JSON-RPC over postMessage with the host that frames the
// page, and through it the `studio mcp` tools the page calls.
const PROTOCOL_VERSION = '2026-01-26';
const LOAD_FAILED = 'Your sites could not load. Try again.';

type JsonRecord = Record< string, unknown >;

const record = ( value: unknown ): JsonRecord =>
	value && typeof value === 'object' && ! Array.isArray( value ) ? ( value as JsonRecord ) : {};
const owns = ( value: unknown, key: string ) =>
	Object.prototype.hasOwnProperty.call( record( value ), key );
const text = ( value: unknown ) => ( typeof value === 'string' ? value : '' );

// Some hosts (Codex) pass tool results wrapped as JSON text.
export function unwrap( value: unknown ): ToolResult {
	const payload = record( value );
	if ( owns( payload, '_meta' ) || payload.isError ) {
		return payload as ToolResult;
	}
	for ( const block of Array.isArray( payload.content ) ? payload.content : [] ) {
		if ( block?.type === 'text' ) {
			try {
				const inner = record( JSON.parse( block.text ) );
				if ( Array.isArray( inner.content ) ) {
					return unwrap( inner );
				}
			} catch {
				// Plain text, not a wrapped result.
			}
		}
	}
	return payload as ToolResult;
}

// The server hands the page its data in the results' `_meta`, which hosts keep
// out of the model's context.
const metaOf = ( value: unknown ): JsonRecord => {
	const result = unwrap( value );
	if ( result.isError ) {
		throw new Error( LOAD_FAILED );
	}
	return record( result._meta );
};

export function localSitesFrom( value: unknown ): LocalSite[] {
	const { localSites } = metaOf( value );
	if ( ! Array.isArray( localSites ) ) {
		throw new Error( LOAD_FAILED );
	}
	return localSites.filter( ( site ) => text( record( site ).id ) );
}

interface Pending {
	resolve: ( value: unknown ) => void;
	reject: ( error: Error ) => void;
	timer: ReturnType< typeof setTimeout >;
}

const host = window.parent;
const pending = new Map< number, Pending >();
const hostListeners = new Set< () => void >();
const resultListeners = new Set< ( read: () => LocalSite[] ) => void >();
let requestId = 0;
let state: HostState = { status: 'starting', capabilities: {}, context: {} };
let captures: Promise< unknown > = Promise.resolve();
let lastResult: ( () => LocalSite[] ) | undefined;

const setState = ( update: Partial< HostState > ) => {
	state = { ...state, ...update };
	hostListeners.forEach( ( listener ) => listener() );
};
const mergeContext = ( context: unknown ) =>
	setState( { context: { ...state.context, ...record( context ) } } );

const send = ( message: JsonRecord ) => host.postMessage( message, '*' );
const notify = ( method: string, params: JsonRecord = {} ) =>
	send( { jsonrpc: '2.0', method, params } );
const request = ( method: string, params: JsonRecord = {}, timeout = 60000 ) =>
	new Promise< unknown >( ( resolve, reject ) => {
		const id = ++requestId;
		const timer = setTimeout( () => {
			pending.delete( id );
			reject( new Error( 'The host did not respond. Try again.' ) );
		}, timeout );
		pending.set( id, { resolve, reject, timer } );
		send( { jsonrpc: '2.0', id, method, params } );
	} );
const callTool = ( name: string, args: JsonRecord = {}, timeout?: number ) =>
	request( 'tools/call', { name, arguments: args }, timeout );

window.addEventListener( 'message', ( event ) => {
	if ( event.source !== host ) {
		return;
	}
	const message = record( event.data );
	if ( message.jsonrpc !== '2.0' ) {
		return;
	}
	const waiting = pending.get( message.id as number );
	if ( waiting && ( owns( message, 'result' ) || owns( message, 'error' ) ) ) {
		pending.delete( message.id as number );
		clearTimeout( waiting.timer );
		if ( message.error ) {
			waiting.reject(
				new Error( text( record( message.error ).message ) || 'The host request failed.' )
			);
		} else {
			waiting.resolve( message.result );
		}
		return;
	}
	if ( message.id !== undefined && typeof message.method === 'string' ) {
		const known = message.method === 'ui/resource-teardown' || message.method === 'ping';
		send(
			known
				? { jsonrpc: '2.0', id: message.id, result: {} }
				: {
						jsonrpc: '2.0',
						id: message.id,
						error: { code: -32601, message: 'Unsupported method.' },
				  }
		);
		return;
	}
	if ( message.method === 'ui/notifications/host-context-changed' ) {
		mergeContext( message.params );
	} else if ( message.method === 'ui/notifications/tool-result' ) {
		const read = () => localSitesFrom( message.params );
		lastResult = read;
		resultListeners.forEach( ( listener ) => listener( read ) );
	}
} );

export async function initialize() {
	try {
		const result = record(
			await request( 'ui/initialize', {
				appInfo: { name: 'WordPress', version: '1.0.0' },
				appCapabilities: { availableDisplayModes: [ 'inline', 'fullscreen' ] },
				protocolVersion: PROTOCOL_VERSION,
			} )
		);
		notify( 'ui/notifications/initialized' );
		setState( {
			status: 'ready',
			capabilities: record( result.hostCapabilities ),
			context: { ...state.context, ...record( result.hostContext ) },
		} );
	} catch {
		setState( { status: 'failed' } );
	}
}

export const getHostState = () => state;

export function subscribeHostState( listener: () => void ) {
	hostListeners.add( listener );
	return () => {
		hostListeners.delete( listener );
	};
}

// The tool result that opened the page carries the sites too.
export function onLocalSitesResult( listener: ( read: () => LocalSite[] ) => void ) {
	resultListeners.add( listener );
	if ( lastResult ) {
		listener( lastResult );
	}
	return () => {
		resultListeners.delete( listener );
	};
}

export async function readLocalSites() {
	return localSitesFrom( await callTool( 'open_wordpress' ) );
}

export async function waitForSiteChanges( since?: number ) {
	// The server answers within a minute even when nothing changes.
	const result = await callTool(
		'wait_for_site_changes',
		since === undefined ? {} : { since },
		90000
	);
	return Number( metaOf( result ).revision ) || 0;
}

export function readSitePreview( siteId: string ): Promise< string | null > {
	// Studio captures one preview at a time.
	const capture = captures.then( () => callTool( 'read_site_preview', { siteId }, 120000 ) );
	captures = capture.catch( () => undefined );
	return capture.then( ( result ) => {
		const image = text( metaOf( result ).image );
		return image.startsWith( 'data:image/' ) ? image : null;
	} );
}

export async function setSiteRunning( sitePath: string, running: boolean ) {
	const result = unwrap(
		await callTool( running ? 'site_start' : 'site_stop', { nameOrPath: sitePath }, 180000 )
	);
	if ( result.isError ) {
		throw new Error( running ? 'The site could not start.' : 'The site could not stop.' );
	}
}

export async function sendMessage( message: UserMessage ) {
	await request( 'ui/message', {
		role: 'user',
		content: [ { type: 'text', text: message.text } ],
		...( message.openaiTarget ? { _meta: { 'openai/message': message.openaiTarget } } : {} ),
	} );
}

export async function updateModelContext( content: string, title: string ) {
	await request( 'ui/update-model-context', {
		content: [ { type: 'text', text: content, _meta: { 'openai/title': title } } ],
	} );
}

export async function openLink( url: string ) {
	try {
		await request( 'ui/open-link', { url } );
	} catch {
		window.open( url, '_blank', 'noopener' );
	}
}

export async function requestDisplayMode( mode: DisplayMode ) {
	const result = record( await request( 'ui/request-display-mode', { mode } ) );
	mergeContext( { displayMode: text( result.mode ) || mode } );
}

export function notifySize( height: number ) {
	notify( 'ui/notifications/size-changed', { width: window.innerWidth, height } );
}
