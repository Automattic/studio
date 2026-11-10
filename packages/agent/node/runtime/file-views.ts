import fs from 'fs';
import { rewriteNotes } from '@studio/agent/node/file-rewrites';

/** Each file the agent holds, as it read when taken (FileViews.read()). */
export type HeldTexts = Map< string, string | undefined >;

/**
 * The text of each file as the agent last held it: as its Write or Edit left
 * the file, or as its Read gave it whole. A file can change after that, as
 * one does that Studio saves a fix to, or a shell command rewrites; an Edit
 * whose text the file has no more hears how it changed since.
 */
export class FileViews {
	private readonly held = new Map< string, { text: string; by: string } >();

	/** The agent's `by` call (Write, Edit or Read) left it holding `text` of `file`. */
	saw( file: string, by: string, text: string | undefined ): void {
		if ( text === undefined ) {
			this.held.delete( file );
		} else {
			this.held.set( file, { text, by } );
		}
	}

	/** Each file the agent holds, as it reads now, for rewritesSince(). */
	read(): HeldTexts {
		return new Map( [ ...this.held.keys() ].map( ( file ) => [ file, readText( file ) ] ) );
	}

	/**
	 * What Studio changed since `before` in the files the agent holds, but
	 * `except`, from the text the agent holds of each: a check that saves a
	 * fix to another file than the call's own, as a save through the block
	 * editor of a template part that repeats a value, says so as a fix to
	 * the written file does (rewriteNotes()).
	 */
	rewritesSince( before: HeldTexts, except: Array< string | undefined > ): string[] {
		const excepted = new Set( except.flatMap( ( file ) => ( file ? [ realPath( file ) ] : [] ) ) );
		return [ ...before ].flatMap( ( [ file, was ] ) => {
			const held = this.held.get( file );
			const now = readText( file );
			return ! held ||
				was === undefined ||
				now === undefined ||
				now === was ||
				excepted.has( realPath( file ) )
				? []
				: rewriteNotes( file, held.text, now );
		} );
	}

	/** How `file`, now `now`, changed since the agent last held it, when it did. */
	changeSince( file: string, now: string | undefined ): string | undefined {
		const held = this.held.get( file );
		if ( ! held || now === undefined || now === held.text ) {
			return undefined;
		}
		return `${ file } changed after your ${
			held.by
		} of it. Its changes since, line by line (- as your ${
			held.by
		} left it, + as it is now):\n${ lineDiff( held.text, now ) }`;
	}
}

// One file, however it is named, as /var and /private/var on macOS.
function realPath( file: string ): string {
	try {
		return fs.realpathSync( file );
	} catch {
		return file;
	}
}

function readText( file: string ): string | undefined {
	try {
		return fs.readFileSync( file, 'utf8' );
	} catch {
		return undefined;
	}
}

// The longest a diff runs before its middle is summed up.
const MAX_DIFF_LINES = 80;
// Lines kept on each side of a change.
const CONTEXT = 2;
// Past this many lines on both sides, a file's changes are taken as one span.
const MAX_LCS_CELLS = 4_000_000;

/** The lines that differ between `before` and `after`, each change with a little context. */
function lineDiff( before: string, after: string ): string {
	const a = before.split( '\n' );
	const b = after.split( '\n' );
	let start = 0;
	while ( start < a.length && start < b.length && a[ start ] === b[ start ] ) {
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while ( endA > start && endB > start && a[ endA - 1 ] === b[ endB - 1 ] ) {
		endA--;
		endB--;
	}
	// Each line of the middle: kept (' '), removed ('-') or added ('+').
	const ops = middleOps( a.slice( start, endA ), b.slice( start, endB ) );
	const lines = [
		...a.slice( Math.max( 0, start - CONTEXT ), start ).map( ( line ) => `  ${ line }` ),
		...collapseKept( ops ),
		...a.slice( endA, endA + CONTEXT ).map( ( line ) => `  ${ line }` ),
	];
	if ( lines.length <= MAX_DIFF_LINES ) {
		return lines.join( '\n' );
	}
	const half = MAX_DIFF_LINES / 2;
	return [
		...lines.slice( 0, half ),
		`  … ${ lines.length - MAX_DIFF_LINES } more lines …`,
		...lines.slice( -half ),
	].join( '\n' );
}

function middleOps( a: string[], b: string[] ): string[] {
	if ( a.length * b.length > MAX_LCS_CELLS ) {
		return [ ...a.map( ( line ) => `- ${ line }` ), ...b.map( ( line ) => `+ ${ line }` ) ];
	}
	// lcs[ i ][ j ]: the longest common run of lines of a from i and b from j.
	const lcs = Array.from( { length: a.length + 1 }, () => new Uint32Array( b.length + 1 ) );
	for ( let i = a.length - 1; i >= 0; i-- ) {
		for ( let j = b.length - 1; j >= 0; j-- ) {
			lcs[ i ][ j ] =
				a[ i ] === b[ j ]
					? lcs[ i + 1 ][ j + 1 ] + 1
					: Math.max( lcs[ i + 1 ][ j ], lcs[ i ][ j + 1 ] );
		}
	}
	const ops: string[] = [];
	let i = 0;
	let j = 0;
	while ( i < a.length || j < b.length ) {
		if ( i < a.length && j < b.length && a[ i ] === b[ j ] ) {
			ops.push( `  ${ a[ i++ ] }` );
			j++;
		} else if ( i < a.length && ( j === b.length || lcs[ i + 1 ][ j ] >= lcs[ i ][ j + 1 ] ) ) {
			ops.push( `- ${ a[ i++ ] }` );
		} else {
			ops.push( `+ ${ b[ j++ ] }` );
		}
	}
	return ops;
}

// A long run of kept lines between two changes, down to its context.
function collapseKept( ops: string[] ): string[] {
	const out: string[] = [];
	let run: string[] = [];
	const flush = () => {
		out.push(
			...( run.length > CONTEXT * 2 + 1
				? [ ...run.slice( 0, CONTEXT ), '  …', ...run.slice( -CONTEXT ) ]
				: run )
		);
		run = [];
	};
	for ( const op of ops ) {
		if ( op.startsWith( '  ' ) ) {
			run.push( op );
		} else {
			flush();
			out.push( op );
		}
	}
	flush();
	return out;
}
