import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { type PullSession } from 'cli/lib/pull/pull-session';
import { getCoreRoots, type ReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import {
	fetchJetpackPullTree,
	mapCliOnlyToReprint,
	selectPullItems,
} from 'cli/lib/pull/reprint-selector';
import { LoggerError } from 'cli/logger';

/** What to pull. An empty selection pulls everything. */
export interface PullSelection {
	skipDatabase?: boolean;
	fileOnlyPaths?: string[];
}

/** The `--only` and `--skip-database` flags. */
export interface CliSelectionOptions {
	only?: string[];
	skipDatabase?: boolean;
}

/**
 * Stores the selection until the pull completes: a resumed pull must reuse
 * it, because Reprint won't resume a file pull whose `--only` paths changed.
 */
const SELECTION_FILE = 'selection.json';

function getSelectionPath( session: PullSession ): string {
	return path.join( session.stateDirectory, SELECTION_FILE );
}

function readPullSelection( session: PullSession ): PullSelection | null {
	try {
		return JSON.parse( fs.readFileSync( getSelectionPath( session ), 'utf-8' ) );
	} catch {
		return null;
	}
}

function savePullSelection( session: PullSession, selection: PullSelection ): void {
	fs.mkdirSync( session.stateDirectory, { recursive: true } );
	fs.writeFileSync( getSelectionPath( session ), JSON.stringify( selection, null, 2 ) + '\n' );
}

export function clearPullSelection( session: PullSession ): void {
	fs.rmSync( getSelectionPath( session ), { force: true } );
}

/**
 * Decides what this pull includes: the selection of an interrupted pull,
 * the CLI flags, or the user's choice in the interactive picker, in that
 * order. Without a terminal or flags, everything is pulled. Returns null
 * when the user cancels.
 */
export async function applySelection( params: {
	session: PullSession;
	isFirstPull: boolean;
	reprintMetadata: ReprintMetadata;
	cli: CliSelectionOptions;
	wpComAccessToken: string;
	wpComSiteId: number;
} ): Promise< PullSelection | null > {
	const { session, isFirstPull, reprintMetadata, cli, wpComAccessToken, wpComSiteId } = params;

	// `--only` replaces Reprint's default paths, so a partial first pull must
	// add WordPress core itself. Without known core paths, pull everything.
	const withCoreRootsOnFirstPull = ( fileOnlyPaths: string[], databaseOnly = false ): string[] => {
		if ( ! isFirstPull || ( fileOnlyPaths.length === 0 && ! databaseOnly ) ) {
			return fileOnlyPaths;
		}
		const coreRoots = getCoreRoots( reprintMetadata );
		if ( coreRoots.length === 0 ) {
			console.log(
				__(
					'Could not determine where WordPress core lives on the remote site; pulling all files instead of the selection.'
				)
			);
			return [];
		}
		return [
			...coreRoots,
			...fileOnlyPaths.filter( ( onlyPath ) => ! coreRoots.includes( onlyPath ) ),
		];
	};

	// Core is added again in case Reprint started over with a fresh download.
	const persisted = readPullSelection( session );
	if ( persisted ) {
		const healed = withCoreRootsOnFirstPull( persisted.fileOnlyPaths ?? [] );
		if ( healed.length !== ( persisted.fileOnlyPaths?.length ?? 0 ) ) {
			persisted.fileOnlyPaths = healed.length > 0 ? healed : undefined;
			savePullSelection( session, persisted );
		}
		return persisted;
	}

	// A site that has never started has no database to keep.
	const assertLocalDatabaseAvailable = ( selection: PullSelection ): void => {
		if ( ! selection.skipDatabase ) {
			return;
		}
		const contentDir = reprintMetadata.sourceSite.contentDirectory;
		const rawContentPath = contentDir
			? path.join( session.rawDirectory, ...contentDir.split( '/' ).filter( Boolean ) )
			: path.join( session.rawDirectory, 'wp-content' );
		const candidates = [
			path.join( session.sitePath, 'wp-content', 'database', '.ht.sqlite' ),
			path.join( rawContentPath, 'database', '.ht.sqlite' ),
			path.join( session.rawDirectory, 'wp-content', 'database', '.ht.sqlite' ),
		];
		if ( ! candidates.some( ( candidate ) => fs.existsSync( candidate ) ) ) {
			throw new LoggerError(
				__(
					'The local site has no database yet (it is created the first time the site starts), so the database cannot be excluded from this pull. Include the database, or start the site once and pull again.'
				)
			);
		}
	};

	const cliOnly = cli.only?.filter( ( value ) => value.trim().length > 0 ) ?? [];
	const cliDriven = cliOnly.length > 0 || cli.skipDatabase;

	if ( cliDriven ) {
		const selection: PullSelection = {
			skipDatabase: !! cli.skipDatabase,
		};
		if ( cliOnly.length > 0 ) {
			const contentDir = reprintMetadata.sourceSite.contentDirectory;
			if ( ! contentDir ) {
				throw new LoggerError(
					__(
						'Could not determine the remote wp-content path from preflight state, so --only cannot be used for this site. Run a full pull, or try again.'
					)
				);
			}
			const withCore = withCoreRootsOnFirstPull( mapCliOnlyToReprint( cliOnly ) );
			if ( withCore.length > 0 ) {
				selection.fileOnlyPaths = withCore;
			}
		}
		assertLocalDatabaseAvailable( selection );
		savePullSelection( session, selection );
		return selection;
	}

	if ( ! process.stdin.isTTY ) {
		// Saved too, so a resume in a terminal doesn't prompt.
		const selection: PullSelection = {};
		savePullSelection( session, selection );
		return selection;
	}

	const contentDir = reprintMetadata.sourceSite.contentDirectory;
	if ( ! contentDir ) {
		const selection: PullSelection = {};
		savePullSelection( session, selection );
		return selection;
	}
	const tree = await fetchJetpackPullTree( wpComAccessToken, wpComSiteId );
	if ( tree.length === 0 ) {
		const selection: PullSelection = {};
		savePullSelection( session, selection );
		return selection;
	}
	const picked = await selectPullItems( tree, {
		allowDatabaseOnly: isFirstPull,
		token: wpComAccessToken,
		remoteSiteId: wpComSiteId,
	} );
	if ( ! picked ) {
		return null;
	}
	const fileOnlyPaths = withCoreRootsOnFirstPull( picked.fileOnlyPaths, ! picked.hasAnyFile );
	const selection: PullSelection = {
		skipDatabase: picked.skipDatabase,
	};
	if ( fileOnlyPaths.length > 0 ) {
		selection.fileOnlyPaths = fileOnlyPaths;
	}
	assertLocalDatabaseAvailable( selection );
	savePullSelection( session, selection );
	return selection;
}
