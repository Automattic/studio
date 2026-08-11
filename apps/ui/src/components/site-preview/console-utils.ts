import type { PreviewConsoleEntry, PreviewConsoleLevel } from './types';

export const MAX_PREVIEW_CONSOLE_ENTRIES = 200;
const MAX_AGENT_CONSOLE_ENTRIES = 40;
const MAX_AGENT_CONSOLE_CHARS = 6000;
const PROMPT_BLOCK_HEADER = 'Recent browser console output from the in-app preview:';

export function getPreviewConsoleLevelFromWebviewLevel( level: unknown ): PreviewConsoleLevel {
	switch ( level ) {
		case 0:
			return 'debug';
		case 1:
			return 'info';
		case 2:
			return 'warning';
		case 3:
			return 'error';
		default:
			return 'log';
	}
}

export function getPreviewConsoleLevelLabel( level: PreviewConsoleLevel ): string {
	switch ( level ) {
		case 'debug':
			return 'Debug';
		case 'info':
			return 'Info';
		case 'warning':
			return 'Warning';
		case 'error':
			return 'Error';
		case 'log':
			return 'Log';
	}
}

export function getPreviewConsoleSourceLabel( entry: PreviewConsoleEntry ): string | null {
	if ( ! entry.sourceId ) {
		return null;
	}
	let source = entry.sourceId;
	try {
		const url = new URL( entry.sourceId );
		source = url.pathname.split( '/' ).filter( Boolean ).pop() || url.hostname || entry.sourceId;
	} catch {
		const parts = entry.sourceId.split( /[/\\]/ ).filter( Boolean );
		source = parts.pop() || entry.sourceId;
	}
	return typeof entry.lineNumber === 'number' && entry.lineNumber > 0
		? `${ source }:${ entry.lineNumber }`
		: source;
}

export function formatPreviewConsoleEntryForText( entry: PreviewConsoleEntry ): string {
	const level = getPreviewConsoleLevelLabel( entry.level ).toUpperCase();
	const source = getPreviewConsoleSourceLabel( entry );
	const location = source ? ` (${ source })` : '';
	return `[${ new Date( entry.timestamp ).toISOString() }] ${ level } ${
		entry.message
	}${ location }`;
}

export function formatPreviewConsoleEntriesForText( entries: PreviewConsoleEntry[] ): string {
	return entries.map( formatPreviewConsoleEntryForText ).join( '\n' );
}

function getPromptLinesWithinLimit( entries: PreviewConsoleEntry[] ): string[] {
	const lines: string[] = [];
	let totalLength = 0;
	for ( const entry of entries.slice( -MAX_AGENT_CONSOLE_ENTRIES ).reverse() ) {
		const line = formatPreviewConsoleEntryForText( entry );
		const nextLength = totalLength + line.length + ( lines.length > 0 ? 1 : 0 );
		if ( nextLength > MAX_AGENT_CONSOLE_CHARS ) {
			break;
		}
		lines.unshift( line );
		totalLength = nextLength;
	}
	return lines;
}

export function buildPreviewConsolePromptBlock( entries: PreviewConsoleEntry[] ): string {
	const lines = getPromptLinesWithinLimit( entries );
	if ( lines.length === 0 ) {
		return '';
	}
	const omittedCount = entries.length - lines.length;
	const omittedLine =
		omittedCount > 0 ? `... ${ omittedCount } older console messages omitted.` : null;
	return [
		'',
		'',
		PROMPT_BLOCK_HEADER,
		'```text',
		...( omittedLine ? [ omittedLine ] : [] ),
		...lines,
		'```',
	].join( '\n' );
}

export function appendPreviewConsoleEntriesToPrompt(
	prompt: string,
	entries: PreviewConsoleEntry[]
): string {
	const block = buildPreviewConsolePromptBlock( entries );
	return block ? `${ prompt }${ block }` : prompt;
}

export function stripPreviewConsolePromptBlock( prompt: string ): string {
	const index = prompt.lastIndexOf( `\n\n${ PROMPT_BLOCK_HEADER }` );
	if ( index === -1 ) {
		return prompt;
	}
	return prompt.slice( 0, index );
}
