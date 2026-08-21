import path from 'path';
import { fileURLToPath } from 'url';
import type {
	LspCallHierarchyIncomingCall,
	LspCallHierarchyItem,
	LspCallHierarchyOutgoingCall,
	LspDiagnostic,
	LspDocumentSymbol,
	LspHover,
	LspLocation,
	LspLocationLink,
	LspMarkedString,
	LspSymbolInformation,
} from './protocol';

// LSP SymbolKind numbers → readable names (the subset wp-lsp emits).
const SYMBOL_KINDS: Record< number, string > = {
	1: 'file',
	2: 'module',
	3: 'namespace',
	4: 'package',
	5: 'class',
	6: 'method',
	7: 'property',
	8: 'field',
	9: 'constructor',
	10: 'enum',
	11: 'interface',
	12: 'function',
	13: 'variable',
	14: 'constant',
	15: 'string',
	16: 'number',
	17: 'boolean',
	18: 'array',
	19: 'object',
	20: 'key',
	21: 'null',
	22: 'enum member',
	23: 'struct',
	24: 'event',
	25: 'operator',
	26: 'type parameter',
};

const DIAGNOSTIC_SEVERITIES: Record< number, string > = {
	1: 'Error',
	2: 'Warning',
	3: 'Info',
	4: 'Hint',
};

export function describeLocation( uri: string, line: number, baseDir: string ): string {
	let filePath: string;
	try {
		filePath = fileURLToPath( uri );
	} catch {
		filePath = uri;
	}
	const relative = path.relative( baseDir, filePath );
	const display = relative && ! relative.startsWith( '..' ) ? relative : filePath;
	// LSP positions are 0-based; agents and editors count from 1.
	return `${ display }:${ line + 1 }`;
}

function isLocationLink( value: LspLocation | LspLocationLink ): value is LspLocationLink {
	return 'targetUri' in value;
}

export function formatLocations(
	result: LspLocation | LspLocation[] | LspLocationLink[] | null,
	baseDir: string
): string {
	if ( ! result ) {
		return 'No results.';
	}
	const list = Array.isArray( result ) ? result : [ result ];
	if ( ! list.length ) {
		return 'No results.';
	}
	return list
		.map( ( entry ) =>
			isLocationLink( entry )
				? describeLocation( entry.targetUri, entry.targetRange.start.line, baseDir )
				: describeLocation( entry.uri, entry.range.start.line, baseDir )
		)
		.join( '\n' );
}

function markedStringToText( content: LspMarkedString ): string {
	return typeof content === 'string' ? content : content.value;
}

export function formatHover( hover: LspHover | null ): string {
	if ( ! hover ) {
		return 'No hover information.';
	}
	const { contents } = hover;
	if ( Array.isArray( contents ) ) {
		return contents.map( markedStringToText ).join( '\n\n' ) || 'No hover information.';
	}
	if ( typeof contents === 'object' && 'kind' in contents ) {
		return contents.value || 'No hover information.';
	}
	return markedStringToText( contents ) || 'No hover information.';
}

function isDocumentSymbol(
	symbol: LspDocumentSymbol | LspSymbolInformation
): symbol is LspDocumentSymbol {
	return 'selectionRange' in symbol;
}

export function formatSymbols(
	symbols: LspDocumentSymbol[] | LspSymbolInformation[] | null,
	baseDir: string
): string {
	if ( ! symbols?.length ) {
		return 'No symbols found.';
	}
	const lines: string[] = [];
	const walk = ( symbol: LspDocumentSymbol, depth: number ) => {
		const kind = SYMBOL_KINDS[ symbol.kind ] ?? 'symbol';
		lines.push(
			`${ '  '.repeat( depth ) }${ symbol.name } (${ kind }) — line ${
				symbol.selectionRange.start.line + 1
			}`
		);
		for ( const child of symbol.children ?? [] ) {
			walk( child, depth + 1 );
		}
	};
	for ( const symbol of symbols ) {
		if ( isDocumentSymbol( symbol ) ) {
			walk( symbol, 0 );
		} else {
			const kind = SYMBOL_KINDS[ symbol.kind ] ?? 'symbol';
			lines.push(
				`${ symbol.name } (${ kind }) — ${ describeLocation(
					symbol.location.uri,
					symbol.location.range.start.line,
					baseDir
				) }`
			);
		}
	}
	return lines.join( '\n' );
}

function formatCallHierarchyItem( item: LspCallHierarchyItem, baseDir: string ): string {
	const kind = SYMBOL_KINDS[ item.kind ] ?? 'symbol';
	const location = describeLocation( item.uri, item.selectionRange.start.line, baseDir );
	const detail = item.detail ? ` — ${ item.detail }` : '';
	return `${ item.name } (${ kind }) — ${ location }${ detail }`;
}

export function formatCallHierarchy(
	calls: LspCallHierarchyIncomingCall[] | LspCallHierarchyOutgoingCall[] | null,
	direction: 'incoming' | 'outgoing',
	baseDir: string
): string {
	if ( ! calls?.length ) {
		return direction === 'incoming' ? 'No incoming calls.' : 'No outgoing calls.';
	}
	return calls
		.map( ( call ) => formatCallHierarchyItem( 'from' in call ? call.from : call.to, baseDir ) )
		.join( '\n' );
}

export function formatDiagnosticLine( diagnostic: LspDiagnostic ): string {
	const severity = DIAGNOSTIC_SEVERITIES[ diagnostic.severity ?? 2 ] ?? 'Warning';
	const code = diagnostic.code !== undefined ? ` [${ diagnostic.code }]` : '';
	return `${ severity } line ${ diagnostic.range.start.line + 1 }: ${
		diagnostic.message
	}${ code }`;
}

export function formatDiagnostics( diagnostics: LspDiagnostic[] ): string {
	if ( ! diagnostics.length ) {
		return 'No problems reported.';
	}
	return diagnostics.map( formatDiagnosticLine ).join( '\n' );
}
