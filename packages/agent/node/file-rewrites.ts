/**
 * What Studio changed in a file after a tool wrote it, as the file now reads.
 *
 * Studio acts on a file a write leaves: it downloads the fonts theme.json
 * names, moves a repeated look into the theme, adds a section's anchor. The
 * agent still holds the text it wrote, so an edit quoting that text would not
 * find it. This quotes each run of lines that changed, as they read now, and
 * states that every other line reads as written.
 */
import { addedMembers } from '@studio/common/lib/json-text';
// The most a note quotes, in lines and characters. In eval30's 66 quoted
// rewrites the median changed 11 lines; 61 changed at most 55, the rest were
// theme.json font faces of 79-109 short lines, and none quoted 5.7k characters.
const MAX_LINES = 120;
const MAX_CHARS = 6000;
// Runs of changed lines this close are quoted as one, with the lines between.
const JOIN_GAP = 3;
// Past this many lines on both sides, a file's changes are taken as one run.
const MAX_LCS_CELLS = 4_000_000;

interface Run {
	// Where the run starts, as written and now, and how many lines it spans in each.
	at: number;
	atNow: number;
	removed: number;
	lines: string[];
}

/** Lines `from` to `to` of a file (from 0, `to` excluded). */
export interface LineSpan {
	from: number;
	to: number;
}

// The runs of lines that differ, by the longest sequence of lines both share.
function runs( before: string[], after: string[] ): Run[] {
	let first = 0;
	while ( first < before.length && first < after.length && before[ first ] === after[ first ] ) {
		first++;
	}
	let last = 0;
	while (
		last < before.length - first &&
		last < after.length - first &&
		before[ before.length - 1 - last ] === after[ after.length - 1 - last ]
	) {
		last++;
	}
	const a = before.slice( first, before.length - last );
	const b = after.slice( first, after.length - last );
	if ( a.length * b.length > MAX_LCS_CELLS ) {
		return [ { at: first, atNow: first, removed: a.length, lines: b } ];
	}
	// shared[ i ][ j ]: how many lines a[ i.. ] and b[ j.. ] share in order.
	const shared = Array.from( { length: a.length + 1 }, () => new Uint32Array( b.length + 1 ) );
	for ( let i = a.length - 1; i >= 0; i-- ) {
		for ( let j = b.length - 1; j >= 0; j-- ) {
			shared[ i ][ j ] =
				a[ i ] === b[ j ]
					? shared[ i + 1 ][ j + 1 ] + 1
					: Math.max( shared[ i + 1 ][ j ], shared[ i ][ j + 1 ] );
		}
	}
	const found: Run[] = [];
	let run: Run | undefined;
	let i = 0;
	let j = 0;
	while ( i < a.length || j < b.length ) {
		if ( i < a.length && j < b.length && a[ i ] === b[ j ] ) {
			run = undefined;
			i++;
			j++;
			continue;
		}
		if ( ! run ) {
			run = { at: first + i, atNow: first + j, removed: 0, lines: [] };
			found.push( run );
		}
		if ( j < b.length && ( i >= a.length || shared[ i ][ j + 1 ] >= shared[ i + 1 ][ j ] ) ) {
			run.lines.push( b[ j++ ] );
		} else {
			run.removed++;
			i++;
		}
	}
	return found;
}

const range = ( { from, to }: LineSpan ) => `${ from + 1 }-${ to }`;

// Each span of `lines` as it reads, numbered, or undefined past the most a
// note quotes or where `quote` is false, and the note naming the spans left.
function quoteSpans(
	lines: string[],
	spans: LineSpan[],
	quote: ( span: LineSpan ) => boolean = () => true
) {
	let linesLeft = MAX_LINES;
	let charsLeft = MAX_CHARS;
	const unquoted: LineSpan[] = [];
	const quotes = spans.map( ( span ) => {
		const quoted = lines.slice( span.from, span.to );
		const chars = quoted.reduce( ( sum, line ) => sum + line.length + 1, 0 );
		if ( ! quote( span ) || quoted.length > linesLeft || chars > charsLeft ) {
			unquoted.push( span );
			return undefined;
		}
		linesLeft -= quoted.length;
		charsLeft -= chars;
		return `Lines ${ range( span ) } now read:\n~~~\n${ quoted.join( '\n' ) }\n~~~`;
	} );
	const left = unquoted.length
		? [
				`Lines ${ unquoted
					.map( range )
					.join( ', ' ) } are not quoted here: Read them before editing them.`,
		  ]
		: [];
	return { quotes, left };
}

/**
 * Each span of `lines` as it reads, numbered, in order, as many as the most
 * a note quotes; the spans past that are named as not quoted.
 */
export function quoteLines( lines: string[], spans: LineSpan[] ): string[] {
	const { quotes, left } = quoteSpans( lines, spans );
	return [ ...quotes.filter( ( quote ) => quote !== undefined ), ...left ];
}

// The lines of `now` that hold only a JSON member `written` lacks: a value
// Studio added, which its note states and no text the agent holds has.
function addedMemberLines( written: string, now: string ): LineSpan[] {
	const lineAt = ( offset: number ) => now.slice( 0, offset ).split( '\n' ).length - 1;
	return addedMembers( written, now )
		.filter(
			( { start, end } ) =>
				! now.slice( now.lastIndexOf( '\n', start - 1 ) + 1, start ).trim() &&
				/^,?[ \t]*(\n|$)/.test( now.slice( end ) )
		)
		.map( ( { start, end } ) => ( { from: lineAt( start ), to: lineAt( end ) + 1 } ) );
}

// `spans` with the lines of `cut` taken out, as spans of their own.
function cutSpans( spans: LineSpan[], cut: LineSpan[] ): LineSpan[] {
	return spans.flatMap( ( span ) => {
		const pieces: LineSpan[] = [];
		let from = span.from;
		for ( const own of cut.filter( ( c ) => c.from < span.to && c.to > span.from ) ) {
			if ( own.from > from ) {
				pieces.push( { from, to: own.from } );
			}
			pieces.push( { from: Math.max( from, own.from ), to: Math.min( span.to, own.to ) } );
			from = Math.min( span.to, own.to );
		}
		if ( from < span.to ) {
			pieces.push( { from, to: span.to } );
		}
		return pieces;
	} );
}

/**
 * What changed from `written` to `now`, quoted as it reads now, in its order:
 * the spans of changed lines, those `JOIN_GAP` apart as one, and the lines gone.
 * The lines of a JSON member Studio added are named, not quoted.
 */
function changedLines( written: string, now: string ): { parts: string[]; whole: boolean } {
	const nowLines = now.split( '\n' );
	const found = runs( written.split( '\n' ), nowLines );
	const joined: LineSpan[] = [];
	for ( const { atNow, lines } of found.filter( ( run ) => run.lines.length ) ) {
		const last = joined.at( -1 );
		if ( last && atNow - last.to <= JOIN_GAP ) {
			last.to = atNow + lines.length;
		} else {
			joined.push( { from: atNow, to: atNow + lines.length } );
		}
	}
	const added = joined.length ? addedMemberLines( written, now ) : [];
	const spans = cutSpans( joined, added );
	const { quotes, left } = quoteSpans(
		nowLines,
		spans,
		( span ) => ! added.some( ( own ) => own.from <= span.from && span.to <= own.to )
	);
	const parts: string[] = [];
	let next = 0;
	for ( const { at, atNow, removed, lines } of found ) {
		while ( next < spans.length && spans[ next ].from <= atNow ) {
			parts.push( quotes[ next++ ] ?? '' );
		}
		// Lines gone between two lines a quote holds are in its quote.
		const inQuote = spans.some( ( span ) => span.from < atNow && atNow < span.to );
		if ( ! lines.length && ! inQuote ) {
			parts.push( `Lines ${ at + 1 }-${ at + removed } as written are gone.` );
		}
	}
	parts.push( ...quotes.slice( next ).map( ( quote ) => quote ?? '' ), ...left );
	return { parts: parts.filter( Boolean ), whole: ! left.length };
}

/**
 * The note on what Studio changed in `filePath` from `written` to `now`, and
 * whether it quotes every line that changed.
 */
export function rewriteReport(
	filePath: string,
	written: string,
	now: string
): { notes: string[]; whole: boolean } {
	if ( written === now ) {
		return { notes: [], whole: true };
	}
	const { parts, whole } = changedLines( written, now );
	return {
		notes: [
			[
				`Studio changed ${ filePath } after the write; every other line reads as written.`,
				...parts,
			].join( '\n' ),
		],
		whole,
	};
}

export function rewriteNotes( filePath: string, written: string, now: string ): string[] {
	return rewriteReport( filePath, written, now ).notes;
}

/** How `now` differs from `before`, quoted as `now` reads, after `heading`. */
export function changeNote( heading: string, before: string, now: string ): string {
	return [ heading, ...changedLines( before, now ).parts ].join( '\n' );
}

// The pairs of characters in a line, for how alike two lines are.
function pairs( line: string ): Map< string, number > {
	const found = new Map< string, number >();
	for ( let i = 0; i < line.length - 1; i++ ) {
		const pair = line.slice( i, i + 2 );
		found.set( pair, ( found.get( pair ) ?? 0 ) + 1 );
	}
	return found;
}

// How alike two lines are, from 0 to 1, by the pairs of characters they share.
function likeness( a: Map< string, number >, b: Map< string, number > ): number {
	let total = 0;
	let shared = 0;
	for ( const [ pair, count ] of a ) {
		shared += Math.min( count, b.get( pair ) ?? 0 );
		total += count;
	}
	for ( const count of b.values() ) {
		total += count;
	}
	return total ? ( 2 * shared ) / total : 0;
}

// Lines quoted on each side of the lines most like a text.
const AROUND = 2;
// The most comparisons of lines a search for a text makes.
const MAX_COMPARISONS = 5_000_000;

/**
 * The lines of `lines` most like `text`, as many as it has and `AROUND` on
 * each side: where an edit made from an older text of the file now applies.
 * Undefined where no lines are half like it.
 */
export function closestLines( lines: string[], text: string ): LineSpan | undefined {
	const wanted = text
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( Boolean );
	const size = text.split( '\n' ).length;
	if ( ! wanted.length || size > lines.length || lines.length * size * size > MAX_COMPARISONS ) {
		return undefined;
	}
	const ofLine = new Map< string, Map< string, number > >();
	const pairsOf = ( line: string ) => {
		const trimmed = line.trim();
		let found = ofLine.get( trimmed );
		if ( ! found ) {
			found = pairs( trimmed );
			ofLine.set( trimmed, found );
		}
		return found;
	};
	// alike[ i ][ j ]: how alike the text's line i is to line j.
	const alike = wanted.map( ( line ) => {
		const want = pairsOf( line );
		return lines.map( ( other ) =>
			other.trim() === line ? 1 : likeness( want, pairsOf( other ) )
		);
	} );
	let best = { at: 0, score: 0 };
	for ( let at = 0; at + size <= lines.length; at++ ) {
		let score = 0;
		for ( const row of alike ) {
			let most = 0;
			for ( let j = at; j < at + size; j++ ) {
				most = Math.max( most, row[ j ] );
			}
			score += most;
		}
		if ( score > best.score ) {
			best = { at, score };
		}
	}
	return best.score / wanted.length < 0.5
		? undefined
		: {
				from: Math.max( 0, best.at - AROUND ),
				to: Math.min( lines.length, best.at + size + AROUND ),
		  };
}
