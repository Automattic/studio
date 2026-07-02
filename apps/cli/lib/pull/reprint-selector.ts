/**
 * Selective-sync prompts for `pull-reprint`.
 *
 * A first pull (keyed on `site.importComplete`) only offers a media-library
 * toggle: reprint's `--only` is an *include* list that replaces the default
 * export roots, so a partial folder selection would drop WordPress core,
 * while excluding uploads rides on `--filter=essential-files` and is safe
 * anytime. Subsequent pulls — core already in the raw fs-root — offer the
 * full wp-content folder tree plus a database toggle.
 *
 * `--only` accepts directories only (a file or symlink-to-file crashes the
 * remote exporter), so the tree is built from directories and symlinks that
 * resolve to directories, e.g. wp.com's per-plugin symlinks.
 */
import fs from 'fs';
import { checkbox } from '@inquirer/prompts';
import { SiteRuntime } from '@studio/common/lib/site-runtime';
import { __ } from '@wordpress/i18n';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';
import { getContentDirFromState, getRemoteIndexPath } from 'cli/lib/pull/reprint-state';
import { buildRootTree } from 'cli/lib/sync-selector';
import treeCheckbox from 'cli/lib/tree-checkbox';
import type { TreeNode } from 'cli/lib/tree-checkbox';

/** The well-known wp-content children that resolve to reprint path tokens. */
const CONTENT_DIR_TOKENS: Record< string, string > = {
	plugins: ':wp-plugins:',
	'mu-plugins': ':wp-mu-plugins:',
	uploads: ':wp-uploads:',
};

export interface FreshPullSelection {
	skipUploads: boolean;
}

export function freshSelectionFromValues( values: string[] ): FreshPullSelection {
	return { skipUploads: ! values.includes( 'uploads' ) };
}

export async function selectFreshPullOptions(): Promise< FreshPullSelection > {
	const selected = await checkbox( {
		message: __(
			'Select what to pull. WordPress core, plugins, themes, and the database are always included on a first pull.'
		),
		choices: [ { name: __( 'Media library (uploads)' ), value: 'uploads', checked: true } ],
	} );
	return freshSelectionFromValues( selected );
}

export interface PullSelection {
	/** reprint `--only` source values; empty means "everything" (no `--only`). */
	fileOnlyPaths: string[];
	/** True when "Database" was unchecked. */
	skipDatabase: boolean;
	/** False when only the database was selected. */
	hasAnyFile: boolean;
}

/** Append the directory-marker slash and sort each level alphabetically. */
function finalizeNodes( nodes: TreeNode[] ): TreeNode[] {
	for ( const node of nodes ) {
		if ( ! node.name.endsWith( '/' ) ) {
			node.name += '/';
		}
		if ( node.children?.length ) {
			node.children = finalizeNodes( node.children );
		}
	}
	return [ ...nodes ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
}

/**
 * Parse reprint's remote index into the nested wp-content child tree,
 * keeping only directories. A path counts as a directory when it has
 * indexed descendants, is `type:dir`, or is a `link` whose target has
 * indexed descendants (covers wp.com's per-plugin symlinks).
 */
function parseIndexChildren( remoteIndexPath: string, contentDir: string ): TreeNode[] {
	const contentRoot = contentDir.replace( /\/+$/, '' );
	const prefix = contentRoot + '/';

	let raw: string;
	try {
		raw = fs.readFileSync( remoteIndexPath, 'utf-8' );
	} catch {
		return [];
	}

	const entryByPath = new Map< string, { type?: string; target?: string } >();
	const dirPrefixes = new Set< string >();
	const contentEntries: string[] = [];

	for ( const line of raw.split( '\n' ) ) {
		if ( ! line.trim() ) {
			continue;
		}
		let entry: { path?: string; type?: string; target?: string };
		try {
			entry = JSON.parse( line );
		} catch {
			continue;
		}
		if ( typeof entry.path !== 'string' || entry.path === '' ) {
			continue;
		}
		const absolutePath = Buffer.from( entry.path, 'base64' ).toString( 'utf-8' );
		const target =
			typeof entry.target === 'string' && entry.target
				? Buffer.from( entry.target, 'base64' ).toString( 'utf-8' )
				: undefined;
		entryByPath.set( absolutePath, { type: entry.type, target } );

		const segments = absolutePath.split( '/' );
		for ( let i = 1; i < segments.length; i++ ) {
			dirPrefixes.add( segments.slice( 0, i ).join( '/' ) );
		}

		if ( absolutePath.startsWith( prefix ) ) {
			contentEntries.push( absolutePath );
		}
	}

	const isDirectory = ( absolutePath: string ): boolean => {
		if ( dirPrefixes.has( absolutePath ) ) {
			return true;
		}
		const entry = entryByPath.get( absolutePath );
		if ( entry?.type === 'dir' ) {
			return true;
		}
		return entry?.type === 'link' && !! entry.target && dirPrefixes.has( entry.target );
	};

	const rootChildren: TreeNode[] = [];
	const byPath = new Map< string, TreeNode >();

	for ( const absolutePath of contentEntries ) {
		const relativePath = absolutePath.slice( prefix.length ).replace( /\/+$/, '' );
		if ( ! relativePath ) {
			continue;
		}
		const segments = relativePath.split( '/' );
		let parentChildren = rootChildren;
		let currentRel = '';
		let currentAbs = contentRoot;

		for ( let i = 0; i < segments.length; i++ ) {
			const segment = segments[ i ];
			currentRel = currentRel ? `${ currentRel }/${ segment }` : segment;
			currentAbs = `${ currentAbs }/${ segment }`;
			if ( ! isDirectory( currentAbs ) ) {
				break;
			}

			let node = byPath.get( currentRel );
			if ( ! node ) {
				node = {
					name: segment,
					value: currentRel,
					isDirectory: true,
					checked: true,
					expanded: false,
					depth: i + 1,
					children: [],
				};
				byPath.set( currentRel, node );
				parentChildren.push( node );
			}
			parentChildren = node.children!;
		}
	}

	return finalizeNodes( rootChildren );
}

/**
 * Build the selector tree (Database + wp-content) from reprint's remote
 * index. Empty when there's no content dir or no wp-content entries.
 */
export function buildReprintTreeFromIndex(
	remoteIndexPath: string,
	contentDir: string | null
): TreeNode[] {
	if ( ! contentDir ) {
		return [];
	}
	const children = parseIndexChildren( remoteIndexPath, contentDir );
	if ( children.length === 0 ) {
		return [];
	}
	return buildRootTree( children );
}

/** Map a wp-content-relative node value to a reprint `--only` source value. */
function valueToOnly( value: string, contentDir: string ): string {
	return CONTENT_DIR_TOKENS[ value ] ?? `${ contentDir.replace( /\/+$/, '' ) }/${ value }`;
}

/**
 * Map raw `--only` CLI values (wp-content-relative paths like `plugins/akismet`,
 * or pass-through reprint tokens/absolute paths) to reprint `--only` sources.
 */
export function mapCliOnlyToReprint( values: string[], contentDir: string ): string[] {
	return values
		.map( ( value ) => value.trim() )
		.filter( ( value ) => value.length > 0 )
		.map( ( value ) => {
			if ( value.startsWith( ':' ) || value.startsWith( '/' ) ) {
				return value; // reprint token or absolute path — pass through
			}
			const relative = value.replace( /^wp-content\//, '' ).replace( /\/+$/, '' );
			return valueToOnly( relative, contentDir );
		} );
}

/**
 * Reduce the flat list of checked nodes to the reprint flags, keeping each
 * fully-selected directory and dropping its descendants. A checked
 * `wp-content` root means everything is selected and no `--only` is needed.
 */
export function mapCheckedNodesToSelection(
	selected: TreeNode[],
	contentDir: string
): PullSelection {
	const checkedValues = new Set( selected.map( ( node ) => node.value ) );
	const skipDatabase = ! checkedValues.has( 'database' );

	if ( checkedValues.has( 'wp-content' ) ) {
		return { fileOnlyPaths: [], skipDatabase, hasAnyFile: true };
	}

	const fileNodes = selected.filter(
		( node ) => node.value !== 'database' && node.value !== 'wp-content'
	);

	const maximal = fileNodes.filter( ( node ) => {
		const slash = node.value.lastIndexOf( '/' );
		if ( slash < 0 ) {
			return true;
		}
		return ! checkedValues.has( node.value.slice( 0, slash ) );
	} );

	return {
		fileOnlyPaths: maximal.map( ( node ) => valueToOnly( node.value, contentDir ) ),
		skipDatabase,
		hasAnyFile: fileNodes.length > 0,
	};
}

interface FetchReprintPullTreeParams {
	stateDirectory: string;
	rawDirectory: string;
	apiUrl: string;
	secret: string;
	runtime: SiteRuntime;
	verbose: boolean;
}

/**
 * Run `reprint files-index` (requires a prior preflight) and build the
 * selector tree from the resulting `.import-remote-index.jsonl`.
 */
export async function fetchReprintPullTree(
	params: FetchReprintPullTreeParams
): Promise< { tree: TreeNode[]; contentDir: string | null } > {
	const { stateDirectory, rawDirectory, apiUrl, secret, runtime, verbose } = params;

	const contentDir = getContentDirFromState( stateDirectory );
	if ( ! contentDir ) {
		return { tree: [], contentDir: null };
	}

	await runReprintCommandUntilComplete(
		stateDirectory,
		rawDirectory,
		[
			'files-index',
			apiUrl,
			`--secret=${ secret }`,
			'--no-adaptive',
			`--state-dir=${ stateDirectory }`,
			`--fs-root=${ rawDirectory }`,
		],
		undefined,
		{
			progressLabel: __( 'Scanning remote files' ),
			verboseCommands: verbose,
			runtime,
		}
	);

	const tree = buildReprintTreeFromIndex( getRemoteIndexPath( stateDirectory ), contentDir );
	return { tree, contentDir };
}

/**
 * Prompt for what to refresh. Returns `undefined` when the user cancels, or
 * selects only the database — a database-only refresh isn't supported yet,
 * so guidance is printed and the caller aborts.
 */
export async function selectPullItems(
	tree: TreeNode[],
	contentDir: string
): Promise< PullSelection | undefined > {
	const selected = await treeCheckbox( {
		message: __( 'Select what to refresh from the remote site' ),
		tree,
	} );

	if ( selected.length === 0 ) {
		return undefined;
	}

	const selection = mapCheckedNodesToSelection( selected, contentDir );

	if ( ! selection.hasAnyFile ) {
		console.log(
			__(
				'Refreshing the database on its own is not supported yet. Select at least one folder to refresh.'
			)
		);
		return undefined;
	}

	return selection;
}
