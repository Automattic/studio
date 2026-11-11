import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { type PullSession } from 'cli/lib/pull/pull-session';
import { type ReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import {
	fetchJetpackPullTree,
	mapCliOnlyToReprint,
	selectPullItems,
} from 'cli/lib/pull/reprint-selector';
import { LoggerError } from 'cli/logger';
import type { SyncOption } from '@studio/common/types/sync';

/** What to pull. An empty selection pulls everything. */
export interface PullSelection {
	skipDatabase?: boolean;
	/** Pulls only the database and keeps the local files. Only for sites pulled before. */
	skipFiles?: boolean;
	/** The first pull of a site, with only the database picked. Later pulls use `skipFiles`. */
	databaseOnly?: boolean;
	fileOnlyPaths?: string[];
}

/** Whether the selection pulls the whole site: every file and the database. */
export function isFullPull( selection: PullSelection ): boolean {
	return (
		! selection.skipFiles &&
		! selection.skipDatabase &&
		! selection.databaseOnly &&
		! selection.fileOnlyPaths?.length
	);
}

/** The `--only` and `--skip-database` flags. */
export interface CliSelectionOptions {
	only?: string[];
	skipDatabase?: boolean;
	skipFiles?: boolean;
}

type NonEmptyArray< T > = [ T, ...T[] ];

/** The app's presets. Picked files aren't a preset: they're the paths themselves. */
export type PullSyncPreset = Exclude< SyncOption, 'paths' >;

export interface PullSyncOptions {
	presets: PullSyncPreset[];
	pickedPaths?: NonEmptyArray< string >;
}

/**
 * Parses the sync options the app and the agent send, such as `themes,sqls`. The `paths` option
 * stands for the files picked with `--only`, so it can't come without them.
 */
export function parsePullSyncOptions(
	options: SyncOption[],
	only: string[] = []
): PullSyncOptions {
	const presets = options.filter( ( option ): option is PullSyncPreset => option !== 'paths' );
	const [ firstPath, ...otherPaths ] = only;
	if ( firstPath !== undefined ) {
		return { presets, pickedPaths: [ firstPath, ...otherPaths ] };
	}
	if ( options.includes( 'paths' ) ) {
		throw new LoggerError( __( 'The "paths" option needs the paths to pull, given with --only.' ) );
	}
	return { presets };
}

const FILE_PRESET_SELECTORS: [ PullSyncPreset, string ][] = [
	[ 'plugins', 'plugins' ],
	[ 'themes', 'themes' ],
	// The uploads directory WordPress uses, even where it isn't in wp-content.
	[ 'uploads', ':wp-uploads:' ],
];

/** The selection for the parsed sync options. `contents` stands for the rest of wp-content, so it pulls every file. */
export function pullSelectionFromSyncOptions( {
	presets,
	pickedPaths,
}: PullSyncOptions ): CliSelectionOptions {
	if ( presets.includes( 'all' ) || ( presets.length === 0 && ! pickedPaths ) ) {
		return {};
	}
	const skipDatabase = ! presets.includes( 'sqls' );
	if ( presets.includes( 'contents' ) ) {
		return { skipDatabase };
	}
	const files =
		pickedPaths ??
		FILE_PRESET_SELECTORS.filter( ( [ preset ] ) => presets.includes( preset ) ).map(
			( [ , selector ] ) => selector
		);
	return files.length > 0 ? { only: files, skipDatabase } : { skipFiles: true };
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

	const persisted = readPullSelection( session );
	if ( persisted ) {
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

	if ( cli.skipFiles ) {
		const selection: PullSelection = isFirstPull ? { databaseOnly: true } : { skipFiles: true };
		savePullSelection( session, selection );
		return selection;
	}

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
			const onlyPaths = mapCliOnlyToReprint( cliOnly );
			if ( onlyPaths.length > 0 ) {
				selection.fileOnlyPaths = onlyPaths;
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
	const selection: PullSelection = {
		skipDatabase: picked.skipDatabase,
	};
	// The picker offers a database-only pull only on a first pull.
	if ( ! picked.hasAnyFile ) {
		selection.databaseOnly = true;
	} else if ( picked.fileOnlyPaths.length > 0 ) {
		selection.fileOnlyPaths = picked.fileOnlyPaths;
	}
	assertLocalDatabaseAvailable( selection );
	savePullSelection( session, selection );
	return selection;
}
