/**
 * First-pull preservation of local wp-content.
 *
 * A first pull replaces the site's real `wp-content` directory with a
 * symlink into the fs-root (`raw/<contentDir>`): `flat-docroot
 * --force` recursively deletes whatever the symlink displaces. With a
 * partial selection, "unchecked items will not be changed" therefore
 * means *moving* the unchecked local entries into the fs-root before
 * flattening, so they remain reachable through the symlinked layout.
 *
 * The move is presence- and selection-aware, applied recursively:
 *   - an entry covered by the selection belongs to the remote — never
 *     seeded, even when the remote copy hasn't materialized yet (the
 *     media library is deferred to the post-start tail);
 *   - an entry absent from the fs-root is moved wholesale;
 *   - a directory present on both sides recurses, so siblings of a
 *     selected subfolder (e.g. local `plugins/foo` next to selected
 *     `plugins/akismet`) survive;
 *   - a file present on both sides stays remote — the user asked for it.
 *
 * `skipDatabase` overrides coverage for its directory:
 * "pull all files but keep my database" selects everything
 * (`selectedPrefixes` empty) yet must still carry the local
 * `wp-content/database` across.
 */
import fs from 'fs';
import path from 'path';

export interface PreserveLocalContentParams {
	/** The site directory whose `wp-content` is about to be flattened. */
	sitePath: string;
	/** The fs-root mirroring remote paths. */
	rawDirectory: string;
	/** Remote WP_CONTENT_DIR absolute path (from preflight). */
	contentDir: string;
	/** Absolute remote path prefixes the user selected (empty = everything). */
	selectedPrefixes: string[];
	/** True when the database is not pulled — keep the local one. */
	skipDatabase?: boolean;
}

type CoveredBySelection = ( absolutePath: string ) => boolean;

function moveAcross( from: string, to: string ): void {
	try {
		fs.renameSync( from, to );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code !== 'EXDEV' ) {
			throw error;
		}
		fs.cpSync( from, to, { recursive: true, verbatimSymlinks: true } );
		fs.rmSync( from, { recursive: true, force: true } );
	}
}

function seedEntry(
	localEntry: string,
	rawEntry: string,
	absolutePath: string,
	covered: CoveredBySelection
): number {
	let rawStats: fs.Stats | null = null;
	try {
		rawStats = fs.lstatSync( rawEntry );
	} catch {
		rawStats = null;
	}

	if ( ! rawStats ) {
		moveAcross( localEntry, rawEntry );
		return 1;
	}

	if ( fs.lstatSync( localEntry ).isDirectory() && rawStats.isDirectory() ) {
		let moved = 0;
		for ( const child of fs.readdirSync( localEntry ) ) {
			const childAbsolutePath = `${ absolutePath }/${ child }`;
			if ( covered( childAbsolutePath ) ) {
				continue;
			}
			moved += seedEntry(
				path.join( localEntry, child ),
				path.join( rawEntry, child ),
				childAbsolutePath,
				covered
			);
		}
		return moved;
	}

	return 0;
}

/**
 * Move the unselected local wp-content entries into the fs-root so
 * the flattened site keeps them. No-ops unless the site's `wp-content`
 * is still a real directory (i.e. the site was never flattened), which
 * confines the move to first pulls regardless of how the pull was
 * classified. Returns the number of entries moved.
 */
export function preserveUnselectedLocalContent( params: PreserveLocalContentParams ): number {
	const { sitePath, rawDirectory, contentDir, selectedPrefixes, skipDatabase } = params;

	const localContent = path.join( sitePath, 'wp-content' );
	let localStats: fs.Stats;
	try {
		localStats = fs.lstatSync( localContent );
	} catch {
		return 0;
	}
	if ( ! localStats.isDirectory() ) {
		return 0;
	}

	const contentRoot = contentDir.replace( /\/+$/, '' );
	const rawContent = path.join( rawDirectory, ...contentRoot.split( '/' ).filter( Boolean ) );
	fs.mkdirSync( rawContent, { recursive: true } );

	const coveredByPrefixes: CoveredBySelection = ( absolutePath ) =>
		selectedPrefixes.length === 0 ||
		selectedPrefixes.some(
			( prefix ) => absolutePath === prefix || absolutePath.startsWith( `${ prefix }/` )
		);
	const neverCovered: CoveredBySelection = () => false;

	const forcedLocal = new Set< string >();
	if ( skipDatabase ) {
		forcedLocal.add( 'database' );
	}

	let moved = 0;
	for ( const entry of fs.readdirSync( localContent ) ) {
		const entryAbsolutePath = `${ contentRoot }/${ entry }`;
		const isForcedLocal = forcedLocal.has( entry );
		if ( ! isForcedLocal && coveredByPrefixes( entryAbsolutePath ) ) {
			continue;
		}
		moved += seedEntry(
			path.join( localContent, entry ),
			path.join( rawContent, entry ),
			entryAbsolutePath,
			isForcedLocal ? neverCovered : coveredByPrefixes
		);
	}
	return moved;
}
