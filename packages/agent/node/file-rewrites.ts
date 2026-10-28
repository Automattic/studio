/**
 * What Studio changed in a file after a tool wrote it, as the file now reads.
 *
 * Studio acts on a file a write leaves: it downloads the fonts theme.json
 * names, moves a repeated look into the theme, adds a section's anchor. The
 * agent still holds the text it wrote, so an edit quoting that text would not
 * find it. This states the lines that changed, as they read now.
 */
const MAX_LINES = 40;

export function rewriteNotes( filePath: string, written: string, now: string ): string[] {
	if ( written === now ) {
		return [];
	}
	const before = written.split( '\n' );
	const after = now.split( '\n' );
	let first = 0;
	while ( first < before.length && first < after.length && before[ first ] === after[ first ] ) {
		first++;
	}
	let fromEnd = 0;
	while (
		fromEnd < before.length - first &&
		fromEnd < after.length - first &&
		before[ before.length - 1 - fromEnd ] === after[ after.length - 1 - fromEnd ]
	) {
		fromEnd++;
	}
	const changed = after.slice( first, after.length - fromEnd );
	const lines = `${ first + 1 }-${ first + changed.length }`;
	if ( changed.length === 0 ) {
		return [
			`Studio removed lines ${ first + 1 }-${
				before.length - fromEnd
			} of ${ filePath } as written; the file now reads differently from the text the agent wrote.`,
		];
	}
	if ( changed.length > MAX_LINES ) {
		return [
			`Studio changed lines ${ lines } of ${ filePath } after the write, so the file now reads differently from the text the agent wrote. Read those lines before editing them.`,
		];
	}
	return [
		`Studio changed ${ filePath } after the write; lines ${ lines } now read:\n~~~\n${ changed.join(
			'\n'
		) }\n~~~`,
	];
}
