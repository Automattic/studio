import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';

// Whether `parent` already grants access to `child`: the same path, or a directory
// it sits under. Walks the child's ancestors and defers each comparison to
// arePathsEqual, so the filesystem decides what counts as the same path.
export function containsPath( parent: string, child: string ): boolean {
	const target = path.normalize( parent );
	let ancestor = path.normalize( child );

	while ( true ) {
		if ( arePathsEqual( target, ancestor ) ) {
			return true;
		}
		// dirname stops making progress at the root, which is where the walk ends.
		const parentDir = path.dirname( ancestor );
		if ( parentDir === ancestor ) {
			return false;
		}
		ancestor = parentDir;
	}
}

// open_basedir matches by path prefix, so an entry nested inside another grants
// nothing extra. Dropping the redundant ones keeps the directive short, which
// matters because it rides on the PHP command line and Windows caps that at 32k.
export function dropCoveredPaths( entries: string[] ): string[] {
	const normalized = entries
		.filter( Boolean )
		.map( ( entry ) => path.normalize( entry ) )
		// Shortest first, so a parent is always considered before anything nested in it.
		.sort( ( a, b ) => a.length - b.length );

	const kept: string[] = [];
	for ( const entry of normalized ) {
		// containsPath holds for identical paths too, so this also drops duplicates —
		// including ones that differ only in case on a case-insensitive volume.
		if ( ! kept.some( ( keptEntry ) => containsPath( keptEntry, entry ) ) ) {
			kept.push( entry );
		}
	}
	return kept;
}
