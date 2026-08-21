import { readFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import {
	formatCallHierarchy,
	formatDiagnostics,
	formatHover,
	formatLocations,
	formatSymbols,
} from 'cli/ai/lsp/format';
import { getLspServerForSiteRoot, getSiteRootForFile, type LspServer } from 'cli/ai/lsp/pool';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';
import type {
	LspCallHierarchyIncomingCall,
	LspCallHierarchyItem,
	LspCallHierarchyOutgoingCall,
	LspDocumentSymbol,
	LspHover,
	LspLocation,
	LspLocationLink,
	LspSymbolInformation,
} from 'cli/ai/lsp/protocol';

const POSITION_OPERATIONS = [
	'definition',
	'implementation',
	'references',
	'hover',
	'incomingCalls',
	'outgoingCalls',
] as const;

const COLD_REQUEST_TIMEOUT_MS = 30_000;
const DIAGNOSTICS_WAIT_MS = 3_000;
const COLD_DIAGNOSTICS_WAIT_MS = 10_000;

type PositionOperation = ( typeof POSITION_OPERATIONS )[ number ];

function isPositionOperation( operation: string ): operation is PositionOperation {
	return ( POSITION_OPERATIONS as readonly string[] ).includes( operation );
}

function resolveFilePath( filePath: string ): string {
	return path.isAbsolute( filePath ) ? filePath : path.join( STUDIO_SITES_ROOT, filePath );
}

async function syncFromDisk( server: LspServer, absolutePath: string ): Promise< string > {
	const content = await readFile( absolutePath, 'utf8' );
	return server.client.syncDocument( absolutePath, content );
}

async function requestAtPosition< T >(
	server: LspServer,
	method: string,
	uri: string,
	line: number,
	column: number,
	extraParams: Record< string, unknown > = {}
): Promise< T > {
	const result = await server.client.request< T >(
		method,
		{
			textDocument: { uri },
			// The agent counts from 1, LSP from 0.
			position: { line: line - 1, character: column - 1 },
			...extraParams,
		},
		server.warmedUp ? undefined : COLD_REQUEST_TIMEOUT_MS
	);
	server.warmedUp = true;
	return result;
}

async function runCallHierarchy(
	server: LspServer,
	uri: string,
	line: number,
	column: number,
	direction: 'incoming' | 'outgoing'
): Promise< string > {
	const items = await requestAtPosition< LspCallHierarchyItem[] | null >(
		server,
		'textDocument/prepareCallHierarchy',
		uri,
		line,
		column
	);
	const item = items?.[ 0 ];
	if ( ! item ) {
		return 'No callable symbol at this position.';
	}
	if ( direction === 'incoming' ) {
		const calls = await server.client.request< LspCallHierarchyIncomingCall[] | null >(
			'callHierarchy/incomingCalls',
			{ item }
		);
		return formatCallHierarchy( calls, 'incoming', server.siteRoot );
	}
	const calls = await server.client.request< LspCallHierarchyOutgoingCall[] | null >(
		'callHierarchy/outgoingCalls',
		{ item }
	);
	return formatCallHierarchy( calls, 'outgoing', server.siteRoot );
}

export const lspTool = defineTool(
	'Lsp',
	'Query the WordPress language server (wp-lsp) for exact code intelligence on PHP files. It resolves WordPress strings the way core does: a hook name goes to where it is fired and to every attached callback (in priority order, including `[ $this, "method" ]`), a post type / taxonomy / shortcode slug goes to its `register_*()` call, a block name connects `block.json` with its PHP and JS halves, a script or style handle finds its registration and enqueues, and an option or meta key finds its reads and writes. Prefer this over Grep whenever you are tracing a WordPress identifier — it returns the resolved answer instead of every textual match. Operations: `definition` (where the thing under the cursor is declared or fired), `implementation` (the callbacks/registrations behind it), `references` (every mention, PHP and JS), `hover` (signature, docs, hook listeners), `documentSymbols` (outline of one file), `workspaceSymbols` (search symbols by name across the site), `incomingCalls` / `outgoingCalls` (call hierarchy; a hook counts as a call-graph node: incoming = where it is fired, outgoing = its listeners), `diagnostics` (current WordPress problems in a file). Position operations need filePath plus 1-based line and column pointing at the identifier. `workspaceSymbols` needs query, plus site when no filePath is given.',
	{
		operation: Type.Union(
			[
				Type.Literal( 'definition' ),
				Type.Literal( 'implementation' ),
				Type.Literal( 'references' ),
				Type.Literal( 'hover' ),
				Type.Literal( 'documentSymbols' ),
				Type.Literal( 'workspaceSymbols' ),
				Type.Literal( 'incomingCalls' ),
				Type.Literal( 'outgoingCalls' ),
				Type.Literal( 'diagnostics' ),
			],
			{ description: 'The code intelligence operation to run' }
		),
		filePath: Type.Optional(
			Type.String( {
				description:
					'Path to a PHP file, absolute or relative to the sites root. Required for every operation except workspaceSymbols.',
			} )
		),
		line: Type.Optional(
			Type.Number( { description: '1-based line of the identifier (position operations)' } )
		),
		column: Type.Optional(
			Type.Number( { description: '1-based column of the identifier (position operations)' } )
		),
		query: Type.Optional(
			Type.String( { description: 'Symbol name to search for (workspaceSymbols only)' } )
		),
		site: Type.Optional(
			Type.String( {
				description:
					'Site name or path used to pick the workspace when filePath is not given (workspaceSymbols only)',
			} )
		),
	},
	async ( { operation, filePath, line, column, query, site } ) => {
		let siteRoot: string;
		let absolutePath: string | undefined;

		if ( filePath ) {
			absolutePath = resolveFilePath( filePath );
			const derived = getSiteRootForFile( absolutePath );
			if ( ! derived ) {
				throw new Error(
					`File is not inside a Studio site: ${ filePath }. Pass a path under the sites root.`
				);
			}
			siteRoot = derived;
		} else if ( operation === 'workspaceSymbols' && site ) {
			siteRoot = ( await resolveSite( site ) ).path;
		} else {
			throw new Error(
				operation === 'workspaceSymbols'
					? 'workspaceSymbols needs either filePath or site to pick the workspace.'
					: `${ operation } requires filePath.`
			);
		}

		const server = await getLspServerForSiteRoot( siteRoot );
		if ( ! server ) {
			throw new Error(
				'wp-lsp is not available (server failed to start). Fall back to Grep and Read.'
			);
		}

		if ( operation === 'workspaceSymbols' ) {
			if ( ! query ) {
				throw new Error( 'workspaceSymbols requires query.' );
			}
			const symbols = await server.client.request< LspSymbolInformation[] | null >(
				'workspace/symbol',
				{ query },
				server.warmedUp ? undefined : COLD_REQUEST_TIMEOUT_MS
			);
			server.warmedUp = true;
			return textResult( formatSymbols( symbols, server.siteRoot ) );
		}

		const uri = await syncFromDisk( server, absolutePath! );

		if ( operation === 'documentSymbols' ) {
			const symbols = await server.client.request<
				LspDocumentSymbol[] | LspSymbolInformation[] | null
			>(
				'textDocument/documentSymbol',
				{ textDocument: { uri } },
				server.warmedUp ? undefined : COLD_REQUEST_TIMEOUT_MS
			);
			server.warmedUp = true;
			return textResult( formatSymbols( symbols, server.siteRoot ) );
		}

		if ( operation === 'diagnostics' ) {
			const diagnostics = await server.client.waitForDiagnostics(
				uri,
				server.warmedUp ? DIAGNOSTICS_WAIT_MS : COLD_DIAGNOSTICS_WAIT_MS
			);
			server.warmedUp = true;
			return textResult( formatDiagnostics( diagnostics ) );
		}

		if ( ! isPositionOperation( operation ) || line === undefined || column === undefined ) {
			throw new Error( `${ operation } requires filePath, line, and column.` );
		}

		switch ( operation ) {
			case 'definition': {
				const result = await requestAtPosition<
					LspLocation | LspLocation[] | LspLocationLink[] | null
				>( server, 'textDocument/definition', uri, line, column );
				return textResult( formatLocations( result, server.siteRoot ) );
			}
			case 'implementation': {
				const result = await requestAtPosition<
					LspLocation | LspLocation[] | LspLocationLink[] | null
				>( server, 'textDocument/implementation', uri, line, column );
				return textResult( formatLocations( result, server.siteRoot ) );
			}
			case 'references': {
				const result = await requestAtPosition< LspLocation[] | null >(
					server,
					'textDocument/references',
					uri,
					line,
					column,
					{ context: { includeDeclaration: true } }
				);
				return textResult( formatLocations( result, server.siteRoot ) );
			}
			case 'hover': {
				const result = await requestAtPosition< LspHover | null >(
					server,
					'textDocument/hover',
					uri,
					line,
					column
				);
				return textResult( formatHover( result ) );
			}
			case 'incomingCalls':
				return textResult( await runCallHierarchy( server, uri, line, column, 'incoming' ) );
			case 'outgoingCalls':
				return textResult( await runCallHierarchy( server, uri, line, column, 'outgoing' ) );
		}
	}
);
