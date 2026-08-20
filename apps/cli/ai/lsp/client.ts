import { pathToFileURL } from 'url';
import {
	encodeMessage,
	LspMessageReader,
	type JsonRpcMessage,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type LspDiagnostic,
	type LspPublishDiagnosticsParams,
} from './protocol';
import type { Readable, Writable } from 'stream';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

interface PendingRequest {
	resolve: ( result: unknown ) => void;
	reject: ( error: Error ) => void;
	timer: NodeJS.Timeout;
}

interface DiagnosticsWaiter {
	resolve: ( diagnostics: LspDiagnostic[] ) => void;
	timer: NodeJS.Timeout;
}

export function toFileUri( absolutePath: string ): string {
	return pathToFileURL( absolutePath ).href;
}

/**
 * JSON-RPC client for a language server speaking LSP over a stream pair.
 * Takes streams rather than a child process so tests can drive it with
 * in-memory pipes. Tracks open documents (didOpen/didChange versioning,
 * full-text sync) and caches the last `textDocument/publishDiagnostics`
 * per URI so callers can wait for the push that follows an edit.
 */
export class LspClient {
	private readonly reader = new LspMessageReader();
	private readonly pending = new Map< number, PendingRequest >();
	private readonly documentVersions = new Map< string, number >();
	private readonly diagnosticsByUri = new Map< string, LspDiagnostic[] >();
	private readonly diagnosticsWaiters = new Map< string, DiagnosticsWaiter[] >();
	private nextRequestId = 1;
	private disposed = false;

	constructor(
		private readonly stdin: Writable,
		stdout: Readable
	) {
		stdout.on( 'data', ( chunk: Buffer ) => {
			let messages: JsonRpcMessage[];
			try {
				messages = this.reader.push( chunk );
			} catch ( error ) {
				this.dispose( error instanceof Error ? error.message : String( error ) );
				return;
			}
			for ( const message of messages ) {
				this.handleMessage( message );
			}
		} );
	}

	async request< T >(
		method: string,
		params: unknown,
		timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
	): Promise< T > {
		if ( this.disposed ) {
			throw new Error( 'wp-lsp: server connection is closed' );
		}
		const id = this.nextRequestId++;
		const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
		return new Promise< T >( ( resolve, reject ) => {
			const timer = setTimeout( () => {
				this.pending.delete( id );
				reject( new Error( `wp-lsp: '${ method }' timed out after ${ timeoutMs }ms` ) );
			}, timeoutMs );
			timer.unref?.();
			this.pending.set( id, {
				resolve: ( result ) => resolve( result as T ),
				reject,
				timer,
			} );
			this.stdin.write( encodeMessage( message ) );
		} );
	}

	notify( method: string, params?: unknown ): void {
		if ( this.disposed ) {
			return;
		}
		this.stdin.write( encodeMessage( { jsonrpc: '2.0', method, params } ) );
	}

	/**
	 * Bring the server's view of a file in line with the given content:
	 * `didOpen` on first sight, full-text `didChange` afterwards. wp-lsp
	 * pushes diagnostics for the file after either notification.
	 */
	syncDocument( absolutePath: string, content: string ): string {
		const uri = toFileUri( absolutePath );
		const version = this.documentVersions.get( uri );
		if ( version === undefined ) {
			this.documentVersions.set( uri, 1 );
			this.notify( 'textDocument/didOpen', {
				textDocument: { uri, languageId: 'php', version: 1, text: content },
			} );
		} else {
			const nextVersion = version + 1;
			this.documentVersions.set( uri, nextVersion );
			this.notify( 'textDocument/didChange', {
				textDocument: { uri, version: nextVersion },
				contentChanges: [ { text: content } ],
			} );
		}
		return uri;
	}

	/**
	 * Resolve with the next diagnostics push for the URI, or with the last
	 * cached set if nothing arrives before the timeout. Call after
	 * `syncDocument` so the push being awaited reflects the new content.
	 */
	waitForDiagnostics( uri: string, timeoutMs: number ): Promise< LspDiagnostic[] > {
		if ( this.disposed ) {
			return Promise.resolve( this.diagnosticsByUri.get( uri ) ?? [] );
		}
		return new Promise< LspDiagnostic[] >( ( resolve ) => {
			const waiters = this.diagnosticsWaiters.get( uri ) ?? [];
			const waiter: DiagnosticsWaiter = {
				resolve,
				timer: setTimeout( () => {
					const current = this.diagnosticsWaiters.get( uri ) ?? [];
					this.diagnosticsWaiters.set(
						uri,
						current.filter( ( w ) => w !== waiter )
					);
					resolve( this.diagnosticsByUri.get( uri ) ?? [] );
				}, timeoutMs ),
			};
			waiter.timer.unref?.();
			waiters.push( waiter );
			this.diagnosticsWaiters.set( uri, waiters );
		} );
	}

	getCachedDiagnostics( uri: string ): LspDiagnostic[] {
		return this.diagnosticsByUri.get( uri ) ?? [];
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	dispose( reason = 'connection closed' ): void {
		if ( this.disposed ) {
			return;
		}
		this.disposed = true;
		for ( const [ , entry ] of this.pending ) {
			clearTimeout( entry.timer );
			entry.reject( new Error( `wp-lsp: ${ reason }` ) );
		}
		this.pending.clear();
		for ( const [ uri, waiters ] of this.diagnosticsWaiters ) {
			for ( const waiter of waiters ) {
				clearTimeout( waiter.timer );
				waiter.resolve( this.diagnosticsByUri.get( uri ) ?? [] );
			}
		}
		this.diagnosticsWaiters.clear();
	}

	private handleMessage( message: JsonRpcMessage ): void {
		if ( 'id' in message && ! ( 'method' in message ) ) {
			this.handleResponse( message );
			return;
		}
		if ( 'id' in message && 'method' in message ) {
			// Server-to-client request (e.g. client/registerCapability). Studio's
			// client supports none of them; an empty result keeps the server from
			// stalling on the reply.
			this.stdin.write(
				encodeMessage( { jsonrpc: '2.0', id: ( message as JsonRpcRequest ).id, result: null } )
			);
			return;
		}
		if ( 'method' in message && message.method === 'textDocument/publishDiagnostics' ) {
			const params = message.params as LspPublishDiagnosticsParams;
			this.diagnosticsByUri.set( params.uri, params.diagnostics );
			const waiters = this.diagnosticsWaiters.get( params.uri );
			if ( waiters?.length ) {
				this.diagnosticsWaiters.delete( params.uri );
				for ( const waiter of waiters ) {
					clearTimeout( waiter.timer );
					waiter.resolve( params.diagnostics );
				}
			}
		}
		// Other notifications (window/logMessage, …) are intentionally ignored.
	}

	private handleResponse( response: JsonRpcResponse ): void {
		const entry = typeof response.id === 'number' ? this.pending.get( response.id ) : undefined;
		if ( ! entry ) {
			return;
		}
		this.pending.delete( response.id as number );
		clearTimeout( entry.timer );
		if ( response.error ) {
			entry.reject( new Error( `wp-lsp: ${ response.error.message }` ) );
		} else {
			entry.resolve( response.result );
		}
	}
}
