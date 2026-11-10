import fs from 'fs';
import {
	changeNote,
	closestLines,
	quoteLines,
	rewriteReport,
	type LineSpan,
} from '@studio/agent/node/file-rewrites';

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
				: this.report( file, held, now );
		} );
	}

	// The note on what changed in `file` from the text the agent holds; one
	// quoting every change leaves the agent holding the file as it reads now.
	private report( file: string, held: { text: string; by: string }, now: string ): string[] {
		const { notes, whole } = rewriteReport( file, held.text, now );
		if ( whole ) {
			this.held.set( file, { text: now, by: held.by } );
		}
		return notes;
	}

	/**
	 * Studio's notes quoted each line that changed in `file` from `from`, the
	 * text the agent holds, to `now`, so the agent holds `now`.
	 */
	told( file: string, from: string | undefined, now: string | undefined ): void {
		const held = this.held.get( file );
		if (
			held &&
			from === held.text &&
			now !== undefined &&
			rewriteReport( file, from, now ).whole
		) {
			this.held.set( file, { text: now, by: held.by } );
		}
	}

	/**
	 * Where `file`, now `now`, reads closest to each of `wanted`, the texts an
	 * Edit looked for, it does not hold, and how the file changed since the
	 * agent last held it, when it did: an edit made from the file as the agent
	 * holds it, or recalls it, applies there.
	 */
	missedEdit( file: string, now: string | undefined, wanted: string[] ): string | undefined {
		if ( now === undefined ) {
			return undefined;
		}
		const held = this.held.get( file );
		const changed = held && now !== held.text ? held : undefined;
		const lines = now.split( '\n' );
		const spans = wanted
			.filter( ( text ) => text && ! now.includes( text ) )
			.flatMap( ( text ) => closestLines( lines, text ) ?? [] )
			.sort( ( a, b ) => a.from - b.from )
			.reduce< LineSpan[] >( ( joined, span ) => {
				const last = joined.at( -1 );
				if ( last && span.from <= last.to ) {
					last.to = Math.max( last.to, span.to );
				} else {
					joined.push( { ...span } );
				}
				return joined;
			}, [] );
		if ( spans.length ) {
			return [
				changed
					? `${ file } changed after your ${ changed.by } of it. Where it now reads closest to the text the Edit looked for:`
					: `Where ${ file } reads closest to the text the Edit looked for:`,
				...quoteLines( lines, spans ),
			].join( '\n' );
		}
		return changed
			? changeNote(
					`${ file } changed after your ${ changed.by } of it; every other line reads as your ${ changed.by } left it.`,
					changed.text,
					now
			  )
			: undefined;
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
