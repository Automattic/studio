import { diffLines } from 'diff';

// pi-coding-agent's edit logic (core/tools/edit-diff.js, MIT), whose module
// also imports Node's fs: the same matching, so Edit behaves alike in both
// agents. Keep it in step with pi's when pi changes.

interface Edit {
	oldText: string;
	newText: string;
}

interface MatchedEdit {
	editIndex: number;
	matchIndex: number;
	matchLength: number;
	newText: string;
}

interface Span {
	start: number;
	end: number;
}

export function detectLineEnding( content: string ): '\r\n' | '\n' {
	const crlfIndex = content.indexOf( '\r\n' );
	const lfIndex = content.indexOf( '\n' );
	if ( lfIndex === -1 || crlfIndex === -1 ) {
		return '\n';
	}
	return crlfIndex < lfIndex ? '\r\n' : '\n';
}

export function normalizeToLF( text: string ): string {
	return text.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );
}

export function restoreLineEndings( text: string, ending: '\r\n' | '\n' ): string {
	return ending === '\r\n' ? text.replace( /\n/g, '\r\n' ) : text;
}

// The model never includes an invisible BOM in oldText.
export function stripBom( content: string ): { bom: string; text: string } {
	return content.startsWith( '\uFEFF' )
		? { bom: '\uFEFF', text: content.slice( 1 ) }
		: { bom: '', text: content };
}

// Trailing whitespace, smart quotes, Unicode dashes and special spaces don't
// stop a match.
function normalizeForFuzzyMatch( text: string ): string {
	return text
		.normalize( 'NFKC' )
		.split( '\n' )
		.map( ( line ) => line.trimEnd() )
		.join( '\n' )
		.replace( /[\u2018\u2019\u201A\u201B]/g, "'" )
		.replace( /[\u201C\u201D\u201E\u201F]/g, '"' )
		.replace( /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-' )
		.replace( /[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ' );
}

function splitLinesWithEndings( content: string ): string[] {
	return content.match( /[^\n]*\n|[^\n]+/g ) ?? [];
}

function getLineSpans( content: string ): Span[] {
	let offset = 0;
	return splitLinesWithEndings( content ).map( ( line ) => {
		const span = { start: offset, end: offset + line.length };
		offset = span.end;
		return span;
	} );
}

function getReplacementLineRange( lines: Span[], replacement: MatchedEdit ) {
	const start = replacement.matchIndex;
	const end = replacement.matchIndex + replacement.matchLength;
	const startLine = lines.findIndex( ( line ) => start >= line.start && start < line.end );
	if ( startLine === -1 ) {
		throw new Error( 'Replacement range is outside the base content.' );
	}
	let endLine = startLine;
	while ( endLine < lines.length && lines[ endLine ].end < end ) {
		endLine++;
	}
	if ( endLine >= lines.length ) {
		throw new Error( 'Replacement range is outside the base content.' );
	}
	return { startLine, endLine: endLine + 1 };
}

function applyReplacements( content: string, replacements: MatchedEdit[], offset = 0 ): string {
	let result = content;
	for ( let i = replacements.length - 1; i >= 0; i-- ) {
		const { matchIndex, matchLength, newText } = replacements[ i ];
		const index = matchIndex - offset;
		result = result.substring( 0, index ) + newText + result.substring( index + matchLength );
	}
	return result;
}

// Applies replacements matched in the fuzzy-normalized `baseContent` to the
// lines they touch, and copies every other line back from `originalContent`.
function applyReplacementsPreservingUnchangedLines(
	originalContent: string,
	baseContent: string,
	replacements: MatchedEdit[]
): string {
	const originalLines = splitLinesWithEndings( originalContent );
	const baseLines = getLineSpans( baseContent );
	if ( originalLines.length !== baseLines.length ) {
		throw new Error(
			'Cannot preserve unchanged lines because the base content has a different line count.'
		);
	}
	const groups: Array< { startLine: number; endLine: number; replacements: MatchedEdit[] } > = [];
	for ( const replacement of [ ...replacements ].sort( ( a, b ) => a.matchIndex - b.matchIndex ) ) {
		const range = getReplacementLineRange( baseLines, replacement );
		const current = groups[ groups.length - 1 ];
		if ( current && range.startLine < current.endLine ) {
			current.endLine = Math.max( current.endLine, range.endLine );
			current.replacements.push( replacement );
			continue;
		}
		groups.push( { ...range, replacements: [ replacement ] } );
	}
	let originalLineIndex = 0;
	let result = '';
	for ( const group of groups ) {
		result += originalLines.slice( originalLineIndex, group.startLine ).join( '' );
		const start = baseLines[ group.startLine ].start;
		const end = baseLines[ group.endLine - 1 ].end;
		result += applyReplacements( baseContent.slice( start, end ), group.replacements, start );
		originalLineIndex = group.endLine;
	}
	return result + originalLines.slice( originalLineIndex ).join( '' );
}

// Exact match first, then fuzzy, in normalized space.
function fuzzyFindText( content: string, oldText: string ) {
	const exactIndex = content.indexOf( oldText );
	if ( exactIndex !== -1 ) {
		return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false };
	}
	const fuzzyOldText = normalizeForFuzzyMatch( oldText );
	const fuzzyIndex = normalizeForFuzzyMatch( content ).indexOf( fuzzyOldText );
	return fuzzyIndex === -1
		? { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false }
		: { found: true, index: fuzzyIndex, matchLength: fuzzyOldText.length, usedFuzzyMatch: true };
}

function countOccurrences( content: string, oldText: string ): number {
	return normalizeForFuzzyMatch( content ).split( normalizeForFuzzyMatch( oldText ) ).length - 1;
}

// Applies edits, all matched against the same LF-normalized content.
export function applyEditsToNormalizedContent(
	normalizedContent: string,
	edits: Edit[],
	path: string
): { baseContent: string; newContent: string } {
	const normalizedEdits = edits.map( ( edit ) => ( {
		oldText: normalizeToLF( edit.oldText ),
		newText: normalizeToLF( edit.newText ),
	} ) );
	const total = normalizedEdits.length;
	const which = ( index: number, single: string, many: string ) =>
		total === 1 ? single : many.replace( '%d', String( index ) );
	normalizedEdits.forEach( ( edit, index ) => {
		if ( ! edit.oldText ) {
			throw new Error(
				which(
					index,
					`oldText must not be empty in ${ path }.`,
					`edits[%d].oldText must not be empty in ${ path }.`
				)
			);
		}
	} );
	const usedFuzzyMatch = normalizedEdits.some(
		( edit ) => fuzzyFindText( normalizedContent, edit.oldText ).usedFuzzyMatch
	);
	const replacementBase = usedFuzzyMatch
		? normalizeForFuzzyMatch( normalizedContent )
		: normalizedContent;
	const matched: MatchedEdit[] = normalizedEdits.map( ( edit, index ) => {
		const match = fuzzyFindText( replacementBase, edit.oldText );
		if ( ! match.found ) {
			throw new Error(
				which(
					index,
					`Could not find the exact text in ${ path }. The old text must match exactly including all whitespace and newlines.`,
					`Could not find edits[%d] in ${ path }. The oldText must match exactly including all whitespace and newlines.`
				)
			);
		}
		const occurrences = countOccurrences( replacementBase, edit.oldText );
		if ( occurrences > 1 ) {
			throw new Error(
				which(
					index,
					`Found ${ occurrences } occurrences of the text in ${ path }. The text must be unique. Please provide more context to make it unique.`,
					`Found ${ occurrences } occurrences of edits[%d] in ${ path }. Each oldText must be unique. Please provide more context to make it unique.`
				)
			);
		}
		return {
			editIndex: index,
			matchIndex: match.index,
			matchLength: match.matchLength,
			newText: edit.newText,
		};
	} );
	matched.sort( ( a, b ) => a.matchIndex - b.matchIndex );
	for ( let i = 1; i < matched.length; i++ ) {
		const previous = matched[ i - 1 ];
		if ( previous.matchIndex + previous.matchLength > matched[ i ].matchIndex ) {
			throw new Error(
				`edits[${ previous.editIndex }] and edits[${ matched[ i ].editIndex }] overlap in ${ path }. Merge them into one edit or target disjoint regions.`
			);
		}
	}
	const newContent = usedFuzzyMatch
		? applyReplacementsPreservingUnchangedLines( normalizedContent, replacementBase, matched )
		: applyReplacements( replacementBase, matched );
	if ( newContent === normalizedContent ) {
		throw new Error(
			total === 1
				? `No changes made to ${ path }. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`
				: `No changes made to ${ path }. The replacements produced identical content.`
		);
	}
	return { baseContent: normalizedContent, newContent };
}

// The numbered diff the chat shows for an edit: changed lines with a few lines
// of context around them.
export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4
): { diff: string; firstChangedLine: number | undefined } {
	const parts = diffLines( oldContent, newContent );
	const output: string[] = [];
	const width = String(
		Math.max( oldContent.split( '\n' ).length, newContent.split( '\n' ).length )
	).length;
	const numbered = ( prefix: string, lineNumber: number, line: string ) =>
		output.push( `${ prefix }${ String( lineNumber ).padStart( width, ' ' ) } ${ line }` );
	const skipped = () => output.push( ` ${ ''.padStart( width, ' ' ) } ...` );
	let oldLine = 1;
	let newLine = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;
	const context = ( lines: string[] ) => {
		for ( const line of lines ) {
			numbered( ' ', oldLine, line );
			oldLine++;
			newLine++;
		}
	};
	const skip = ( count: number ) => {
		if ( count > 0 ) {
			skipped();
			oldLine += count;
			newLine += count;
		}
	};
	parts.forEach( ( part, index ) => {
		const raw = part.value.split( '\n' );
		if ( raw[ raw.length - 1 ] === '' ) {
			raw.pop();
		}
		if ( part.added || part.removed ) {
			firstChangedLine ??= newLine;
			for ( const line of raw ) {
				if ( part.added ) {
					numbered( '+', newLine++, line );
				} else {
					numbered( '-', oldLine++, line );
				}
			}
			lastWasChange = true;
			return;
		}
		const next = parts[ index + 1 ];
		const nextIsChange = Boolean( next && ( next.added || next.removed ) );
		if ( lastWasChange && nextIsChange ) {
			if ( raw.length <= contextLines * 2 ) {
				context( raw );
			} else {
				context( raw.slice( 0, contextLines ) );
				skip( raw.length - contextLines * 2 );
				context( raw.slice( raw.length - contextLines ) );
			}
		} else if ( lastWasChange ) {
			context( raw.slice( 0, contextLines ) );
			skip( raw.length - Math.min( raw.length, contextLines ) );
		} else if ( nextIsChange ) {
			const skippedCount = Math.max( 0, raw.length - contextLines );
			skip( skippedCount );
			context( raw.slice( skippedCount ) );
		} else {
			oldLine += raw.length;
			newLine += raw.length;
		}
		lastWasChange = false;
	} );
	return { diff: output.join( '\n' ), firstChangedLine };
}

// Some models send `edits` as a JSON string, and older ones a single
// top-level oldText/newText.
export function prepareEditArguments( input: unknown ): unknown {
	if ( ! input || typeof input !== 'object' ) {
		return input;
	}
	const args = { ...( input as Record< string, unknown > ) };
	if ( typeof args.edits === 'string' ) {
		try {
			const parsed: unknown = JSON.parse( args.edits );
			if ( Array.isArray( parsed ) ) {
				args.edits = parsed;
			}
		} catch {
			// Left as is: validation reports it.
		}
	}
	if ( typeof args.oldText !== 'string' || typeof args.newText !== 'string' ) {
		return args;
	}
	const { oldText, newText, ...rest } = args;
	return {
		...rest,
		edits: [ ...( Array.isArray( args.edits ) ? args.edits : [] ), { oldText, newText } ],
	};
}
