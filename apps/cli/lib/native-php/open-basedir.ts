import fs from 'fs';
import path from 'path';

// The path as the filesystem names it: symlinks resolved and, on case-insensitive
// volumes, the on-disk casing. Segments that don't exist yet are appended to the
// deepest ancestor that does.
//
// Deliberately compares names rather than inode numbers: on Windows, stat's ino is a
// 64-bit file ID squeezed into a double, and ReFS, network and virtual drives can
// report zero or truncated IDs, so unrelated directories can compare as equal.
function canonicalizePath( target: string ): string {
	const resolved = path.resolve( target );
	const missingSegments: string[] = [];
	let current = resolved;

	while ( true ) {
		try {
			return path.join( fs.realpathSync.native( current ), ...missingSegments );
		} catch {
			// Not there yet (or unreadable); try the parent.
		}
		const parent = path.dirname( current );
		if ( parent === current ) {
			return resolved;
		}
		missingSegments.unshift( path.basename( current ) );
		current = parent;
	}
}

function isSameOrNested( canonicalParent: string, canonicalChild: string ): boolean {
	if ( canonicalChild === canonicalParent ) {
		return true;
	}
	const prefix = canonicalParent.endsWith( path.sep )
		? canonicalParent
		: `${ canonicalParent }${ path.sep }`;
	return canonicalChild.startsWith( prefix );
}

// Whether `parent` already grants access to `child`: the same path, or a directory
// it sits under.
export function containsPath( parent: string, child: string ): boolean {
	return isSameOrNested( canonicalizePath( parent ), canonicalizePath( child ) );
}

// open_basedir matches by path prefix, so an entry nested inside another grants
// nothing extra. Dropping the redundant ones keeps the directive short, which
// matters because it rides on the PHP command line and Windows caps that at 32k.
export function dropCoveredPaths( entries: string[] ): string[] {
	const candidates = entries
		.filter( Boolean )
		.map( ( entry ) => {
			const normalized = path.normalize( entry );
			return { entry: normalized, canonical: canonicalizePath( normalized ) };
		} )
		// Shortest first, so a parent is always considered before anything nested in it.
		.sort( ( a, b ) => a.canonical.length - b.canonical.length );

	const kept: typeof candidates = [];
	for ( const candidate of candidates ) {
		// Identical paths count as nested too, so this also drops duplicates —
		// including ones that differ only in case on a case-insensitive volume.
		if (
			! kept.some( ( keptEntry ) => isSameOrNested( keptEntry.canonical, candidate.canonical ) )
		) {
			kept.push( candidate );
		}
	}
	return kept.map( ( { entry } ) => entry );
}
