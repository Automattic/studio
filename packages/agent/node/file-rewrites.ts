/**
 * What Studio changed in a file after a tool wrote it, as the file now reads.
 *
 * Studio acts on a file a write leaves: it downloads the fonts theme.json
 * names, moves a repeated look into the theme, adds a section's anchor. The
 * agent still holds the text it wrote, so an edit quoting that text would not
 * find it. This states each run of lines that changed, as they read now, and
 * that every other line reads as written.
 */
// The most lines a note quotes, and how many it quotes at each end of a longer run.
const MAX_LINES = 40;
const ENDS = 3;

interface Run {
	// Where the run starts, as written and now, and how many lines it spans in each.
	at: number;
	atNow: number;
	removed: number;
	lines: string[];
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
	// shared[ i ][ j ]: how many lines a[ i.. ] and b[ j.. ] share in order.
	const shared = Array.from( { length: a.length + 1 }, () => new Array( b.length + 1 ).fill( 0 ) );
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

const quote = ( from: number, lines: string[] ) =>
	`Lines ${ from }-${ from + lines.length - 1 } now read:\n~~~\n${ lines.join( '\n' ) }\n~~~`;

export function rewriteNotes( filePath: string, written: string, now: string ): string[] {
	if ( written === now ) {
		return [];
	}
	const changed = runs( written.split( '\n' ), now.split( '\n' ) );
	const parts = changed.map( ( { at, atNow, removed, lines } ) => {
		if ( ! lines.length ) {
			return `Lines ${ at + 1 }-${ at + removed } as written are gone.`;
		}
		if ( lines.length <= 2 * ENDS + 1 ) {
			return quote( atNow + 1, lines );
		}
		const unquoted = `Lines ${ atNow + ENDS + 1 }-${
			atNow + lines.length - ENDS
		} are not quoted here: Read them before editing them.`;
		return [
			quote( atNow + 1, lines.slice( 0, ENDS ) ),
			unquoted,
			quote( atNow + lines.length - ENDS + 1, lines.slice( -ENDS ) ),
		].join( '\n' );
	} );
	const quoted = changed.reduce(
		( sum, { lines } ) => sum + Math.min( lines.length, 2 * ENDS + 1 ),
		0
	);
	if ( quoted > MAX_LINES ) {
		return [
			`Studio changed ${ changed.length } runs of lines in ${ filePath } after the write, so the file now reads differently from the text the agent wrote. Read it before editing it.`,
		];
	}
	return [
		`Studio changed ${ filePath } after the write; every other line reads as written.\n${ parts.join(
			'\n'
		) }`,
	];
}
