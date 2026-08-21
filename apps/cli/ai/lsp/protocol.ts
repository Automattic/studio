/**
 * Minimal LSP wire protocol: Content-Length framed JSON-RPC 2.0 over stdio.
 * Hand-rolled instead of depending on vscode-jsonrpc — the client only needs
 * the handful of requests wp-lsp serves.
 */

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params?: unknown;
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// LSP structures, limited to the fields Studio reads.
export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

export interface LspLocationLink {
	targetUri: string;
	targetRange: LspRange;
	targetSelectionRange?: LspRange;
}

export interface LspDiagnostic {
	range: LspRange;
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
}

export interface LspPublishDiagnosticsParams {
	uri: string;
	diagnostics: LspDiagnostic[];
}

export type LspMarkedString = string | { language: string; value: string };

export interface LspHover {
	contents: LspMarkedString | LspMarkedString[] | { kind: string; value: string };
	range?: LspRange;
}

export interface LspDocumentSymbol {
	name: string;
	detail?: string;
	kind: number;
	range: LspRange;
	selectionRange: LspRange;
	children?: LspDocumentSymbol[];
}

export interface LspSymbolInformation {
	name: string;
	kind: number;
	location: LspLocation;
	containerName?: string;
}

export interface LspCallHierarchyItem {
	name: string;
	kind: number;
	detail?: string;
	uri: string;
	range: LspRange;
	selectionRange: LspRange;
}

export interface LspCallHierarchyIncomingCall {
	from: LspCallHierarchyItem;
	fromRanges: LspRange[];
}

export interface LspCallHierarchyOutgoingCall {
	to: LspCallHierarchyItem;
	fromRanges: LspRange[];
}

export function encodeMessage( message: JsonRpcMessage ): Buffer {
	const body = Buffer.from( JSON.stringify( message ), 'utf8' );
	return Buffer.concat( [
		Buffer.from( `Content-Length: ${ body.length }\r\n\r\n`, 'ascii' ),
		body,
	] );
}

/**
 * Incremental Content-Length frame decoder. Feed it raw chunks; it returns
 * every complete message contained so far, buffering partial frames across
 * pushes (frames can be split or coalesced arbitrarily by the pipe).
 */
export class LspMessageReader {
	private buffer: Buffer = Buffer.alloc( 0 );

	push( chunk: Buffer ): JsonRpcMessage[] {
		this.buffer = Buffer.concat( [ this.buffer, chunk ] );
		const messages: JsonRpcMessage[] = [];

		for (;;) {
			const headerEnd = this.buffer.indexOf( '\r\n\r\n' );
			if ( headerEnd === -1 ) {
				break;
			}
			const header = this.buffer.subarray( 0, headerEnd ).toString( 'ascii' );
			const lengthMatch = header.match( /Content-Length:\s*(\d+)/i );
			if ( ! lengthMatch ) {
				throw new Error( `wp-lsp: malformed protocol header: ${ header }` );
			}
			const contentLength = parseInt( lengthMatch[ 1 ], 10 );
			const bodyStart = headerEnd + 4;
			if ( this.buffer.length < bodyStart + contentLength ) {
				break;
			}
			const body = this.buffer.subarray( bodyStart, bodyStart + contentLength ).toString( 'utf8' );
			this.buffer = this.buffer.subarray( bodyStart + contentLength );
			messages.push( JSON.parse( body ) as JsonRpcMessage );
		}

		return messages;
	}
}
