import type {
	Connector,
	DisplayMode,
	HostState,
	Library,
	LiveTool,
	ToolResult,
	UserMessage,
} from '../../types';

// The MCP Apps bridge: JSON-RPC over postMessage with the host that frames the app.
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
	if ( owns( payload, 'structuredContent' ) ) {
		return payload as ToolResult;
	}
	for ( const block of Array.isArray( payload.content ) ? payload.content : [] ) {
		if ( block?.type === 'text' ) {
			try {
				const inner = JSON.parse( block.text );
				if ( inner && typeof inner === 'object' ) {
					return unwrap( inner );
				}
			} catch {
				// Plain text, not a wrapped result.
			}
		}
	}
	return payload as ToolResult;
}

const localSitesFrom = ( content: JsonRecord ): Library[ 'localSites' ] =>
	( Array.isArray( content.localSites ) ? content.localSites : [] ).filter( ( site ) =>
		text( record( site ).id )
	);

const wpcomFrom = ( content: JsonRecord ): Library[ 'wpcom' ] => {
	const wpcom = record( content.wpcom );
	return {
		signedIn: wpcom.signedIn === true,
		sites: Array.isArray( wpcom.sites ) ? wpcom.sites : [],
		error: text( wpcom.error ),
	};
};

// A tool result's structured content, or the library's failure message.
const contentOf = ( value: unknown ): JsonRecord => {
	const payload = unwrap( value );
	if ( payload.isError ) {
		throw new Error( LOAD_FAILED );
	}
	return record( payload.structuredContent );
};

export function libraryFrom( value: unknown ): Library {
	const content = contentOf( value );
	if ( content.view !== 'library' ) {
		throw new Error( LOAD_FAILED );
	}
	return { localSites: localSitesFrom( content ), wpcom: wpcomFrom( content ) };
}

interface Pending {
	resolve: ( value: unknown ) => void;
	reject: ( error: Error ) => void;
	timer: ReturnType< typeof setTimeout >;
}

export function createMcpBridgeConnector( host: Window = window.parent ): Connector {
	const pending = new Map< number, Pending >();
	const hostListeners = new Set< () => void >();
	const libraryListeners = new Set< ( read: () => Library ) => void >();
	let liveTools: LiveTool[] = [];
	let requestId = 0;
	let state: HostState = { status: 'starting', capabilities: {}, context: {} };
	let captures: Promise< unknown > = Promise.resolve();
	let lastLibraryResult: ( () => Library ) | undefined;

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
	const callTool = async ( name: string, args: JsonRecord = {}, timeout?: number ) =>
		unwrap( await request( 'tools/call', { name, arguments: args }, timeout ) );

	const answer = ( method: string, params: unknown ): unknown => {
		if ( method === 'tools/list' ) {
			return { tools: liveTools.map( ( { call: _call, ...tool } ) => tool ) };
		}
		if ( method === 'tools/call' ) {
			const input = record( params );
			const tool = liveTools.find( ( candidate ) => candidate.name === input.name );
			try {
				if ( ! tool ) {
					throw new Error( 'Unknown library tool.' );
				}
				return tool.call( record( input.arguments ) );
			} catch ( error ) {
				return {
					isError: true,
					content: [ { type: 'text', text: text( record( error ).message ) } ],
				};
			}
		}
		if ( method === 'ui/resource-teardown' || method === 'ping' ) {
			return {};
		}
		return undefined;
	};

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
			const result = answer( message.method, message.params );
			send(
				result === undefined
					? {
							jsonrpc: '2.0',
							id: message.id,
							error: { code: -32601, message: 'Unsupported method.' },
					  }
					: { jsonrpc: '2.0', id: message.id, result }
			);
			return;
		}
		if ( message.method === 'ui/notifications/host-context-changed' ) {
			mergeContext( message.params );
		} else if ( message.method === 'ui/notifications/tool-result' ) {
			const read = () => libraryFrom( message.params );
			lastLibraryResult = read;
			libraryListeners.forEach( ( listener ) => listener( read ) );
		}
	} );

	return {
		async initialize() {
			try {
				const result = record(
					await request( 'ui/initialize', {
						appInfo: { name: 'WordPress', version: '1.0.0' },
						appCapabilities: {
							tools: { listChanged: false },
							availableDisplayModes: [ 'inline', 'fullscreen' ],
						},
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
		},
		getHostState: () => state,
		subscribeHostState( listener ) {
			hostListeners.add( listener );
			return () => hostListeners.delete( listener );
		},
		onLibraryResult( listener ) {
			libraryListeners.add( listener );
			if ( lastLibraryResult ) {
				listener( lastLibraryResult );
			}
			return () => libraryListeners.delete( listener );
		},
		setLiveTools( tools ) {
			liveTools = tools;
		},
		async readLocalSites() {
			return localSitesFrom( contentOf( await callTool( 'read_local_sites' ) ) );
		},
		async readWpcomSites() {
			return wpcomFrom( contentOf( await callTool( 'read_wpcom_sites' ) ) );
		},
		async waitForSiteChanges( since ) {
			// The server answers within a minute even when nothing changes.
			const result = await callTool(
				'wait_for_site_changes',
				since === undefined ? {} : { since },
				90000
			);
			return Number( record( result.structuredContent ).revision ) || 0;
		},
		readSitePreview( siteId ) {
			// Studio captures one preview at a time.
			const capture = captures.then( () => callTool( 'read_site_preview', { siteId }, 120000 ) );
			captures = capture.catch( () => undefined );
			return capture.then( ( result ) => {
				const image = text( record( result.structuredContent ).image );
				return image.startsWith( 'data:image/' ) ? image : null;
			} );
		},
		async setSiteRunning( sitePath, running ) {
			const result = await callTool(
				running ? 'site_start' : 'site_stop',
				{ nameOrPath: sitePath },
				180000
			);
			if ( result.isError ) {
				throw new Error( running ? 'The site could not start.' : 'The site could not stop.' );
			}
		},
		async readLoginUrl() {
			return text( record( ( await callTool( 'wpcom_login_url' ) ).structuredContent ).url );
		},
		async logIn( token ) {
			const result = await callTool( 'wpcom_login', { token } );
			if ( result.isError ) {
				throw new Error(
					text( result.content?.[ 0 ]?.text ) || 'That token did not work. Try again.'
				);
			}
		},
		async sendMessage( message: UserMessage ) {
			await request( 'ui/message', {
				role: 'user',
				content: [ { type: 'text', text: message.text } ],
				...( message.openaiTarget ? { _meta: { 'openai/message': message.openaiTarget } } : {} ),
			} );
		},
		async updateModelContext( content, title ) {
			await request( 'ui/update-model-context', {
				content: [ { type: 'text', text: content, _meta: { 'openai/title': title } } ],
			} );
		},
		async openLink( url ) {
			try {
				await request( 'ui/open-link', { url } );
			} catch {
				window.open( url, '_blank', 'noopener' );
			}
		},
		async requestDisplayMode( mode: DisplayMode ) {
			const result = record( await request( 'ui/request-display-mode', { mode } ) );
			mergeContext( { displayMode: text( result.mode ) || mode } );
		},
		notifySize( height ) {
			notify( 'ui/notifications/size-changed', { height } );
		},
	};
}
