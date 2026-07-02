/**
 * Selective-sync prompts and mapping for `pull-reprint`.
 *
 * Two modes, keyed on whether the site has completed a pull before
 * (`site.importComplete`):
 *
 *   - **First pull**: only the media library is optional. Reprint's `--only`
 *     is an *include* list that replaces the default export roots, so any
 *     partial folder selection would drop WordPress core and flat-docroot
 *     could not assemble a site. Uploads-exclusion is the one thing that IS
 *     first-pull-safe, because it rides on `--filter=essential-files` (a
 *     client-side filter that defers uploads while still pulling every
 *     default root) — skipping the deferred pass excludes the media library.
 *
 *   - **Subsequent pulls**: the full wp-content folder tree plus a "Database"
 *     toggle. The raw fs-root already holds core from the completed pull, so
 *     a partial `--only` selection just refreshes the chosen directories.
 *
 * `--only` accepts directories only — a file or symlink-to-file crashes the
 * remote exporter — so the tree is built from directories (and symlinks that
 * resolve to directories, e.g. wp.com's per-plugin symlinks).
 */
import fs from 'fs';
import { checkbox } from '@inquirer/prompts';
import { SiteRuntime } from '@studio/common/lib/site-runtime';
import { __ } from '@wordpress/i18n';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';
import { getContentDirFromState, getRemoteIndexPath } from 'cli/lib/pull/reprint-state';
import treeCheckbox from 'cli/lib/tree-checkbox';
import type { TreeNode } from 'cli/lib/tree-checkbox';

/** The well-known wp-content children that resolve to reprint path tokens. */
const CONTENT_DIR_TOKENS: Record< string, string > = {
	plugins: ':wp-plugins:',
	'mu-plugins': ':wp-mu-plugins:',
	uploads: ':wp-uploads:',
};

// ─── First pull: coarse media toggle ────────────────────────────────────────

export interface FreshPullSelection {
	/** True when the user unchecked "Media library" → skip the deferred-uploads pass. */
	skipUploads: boolean;
}

/** Map the checked option values from the fresh-pull prompt to flags. Pure. */
export function freshSelectionFromValues( values: string[] ): FreshPullSelection {
	return { skipUploads: ! values.includes( 'uploads' ) };
}

/**
 * First-pull prompt: only the media library is optional. WordPress core,
 * plugins, themes, and the database are always pulled so the new site works.
 */
export async function selectFreshPullOptions(): Promise< FreshPullSelection > {
	const selected = await checkbox( {
		message: __(
			'Select what to pull. WordPress core, plugins, themes, and the database are always included on a first pull.'
		),
		choices: [ { name: __( 'Media library (uploads)' ), value: 'uploads', checked: true } ],
	} );
	return freshSelectionFromValues( selected );
}

// ─── Subsequent pulls: fine-grained folder selection ─────────────────────────

export interface PullSelection {
	/** reprint `--only` source values; empty means "everything" (no `--only`). */
	fileOnlyPaths: string[];
	/** True when "Database" was unchecked → pass `--no-db`. */
	skipDatabase: boolean;
	/** True when every file area was selected (no `--only` needed). */
	fullFileSelection: boolean;
	/** True when at least one wp-content area was selected. */
	hasAnyFile: boolean;
}

function sortNodes( nodes: TreeNode[] ): TreeNode[] {
	return [ ...nodes ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
}

function finalizeNodes( nodes: TreeNode[] ): TreeNode[] {
	for ( const node of nodes ) {
		if ( node.isDirectory && ! node.name.endsWith( '/' ) ) {
			node.name += '/';
		}
		if ( node.children?.length ) {
			node.children = finalizeNodes( node.children );
		}
	}
	return sortNodes( nodes );
}

/**
 * Parse reprint's remote index into the nested wp-content child tree.
 *
 * Builds a **directories-only** tree (files and file-symlinks are pruned, since
 * `--only` only accepts directories). Directory classification: a path is a
 * directory if it has indexed descendants, is `type:dir`, or is a `link` whose
 * target has indexed descendants (covers wp.com's per-plugin symlinks).
 */
function parseIndexChildren( remoteIndexPath: string, contentDir: string ): TreeNode[] {
	const prefix = contentDir.replace( /\/+$/, '' ) + '/';

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
		if ( ! entry ) {
			return false;
		}
		if ( entry.type === 'dir' ) {
			return true;
		}
		return entry.type === 'link' && !! entry.target && dirPrefixes.has( entry.target );
	};

	const contentRoot = prefix.replace( /\/$/, '' );
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

			let node = byPath.get( currentRel );
			if ( ! node ) {
				node = {
					name: segment,
					value: currentRel,
					isDirectory: isDirectory( currentAbs ),
					checked: true,
					expanded: false,
					depth: i + 1,
				};
				byPath.set( currentRel, node );
				parentChildren.push( node );
			}

			if ( ! node.isDirectory ) {
				break;
			}
			if ( ! node.children ) {
				node.children = [];
			}
			parentChildren = node.children;
		}
	}

	const pruneFiles = ( nodes: TreeNode[] ): TreeNode[] =>
		nodes
			.filter( ( node ) => node.isDirectory )
			.map( ( node ) => ( {
				...node,
				children: node.children ? pruneFiles( node.children ) : undefined,
			} ) );

	return finalizeNodes( pruneFiles( rootChildren ) );
}

function buildRootTree( wpContentChildren: TreeNode[] ): TreeNode[] {
	return [
		{
			name: __( 'Database' ),
			value: 'database',
			isDirectory: false,
			checked: true,
			expanded: false,
			depth: 0,
		},
		{
			name: 'wp-content/',
			value: 'wp-content',
			isDirectory: true,
			checked: true,
			expanded: true,
			depth: 0,
			children: wpContentChildren,
		},
	];
}

/**
 * Build the complete selector tree (Database + wp-content) from reprint's
 * remote index. Empty when there's no content dir or no wp-content entries.
 * Pure; unit-testable without network.
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
export function valueToOnly( value: string, contentDir: string ): string {
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
 * Reduce the flat list of checked nodes to the reprint flags. "Maximal subtree"
 * reduction keeps a fully-selected directory and drops its descendants; when
 * `wp-content` itself is checked, everything is selected and no `--only` is
 * needed. Pure; exported for unit testing.
 */
export function mapCheckedNodesToSelection(
	selected: TreeNode[],
	contentDir: string
): PullSelection {
	const checkedValues = new Set( selected.map( ( node ) => node.value ) );
	const skipDatabase = ! checkedValues.has( 'database' );

	if ( checkedValues.has( 'wp-content' ) ) {
		return { fileOnlyPaths: [], skipDatabase, fullFileSelection: true, hasAnyFile: true };
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
		fullFileSelection: false,
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
 * Run `reprint files-index` and build the selector tree from the resulting
 * `.import-remote-index.jsonl`. Requires a prior preflight. Returns an empty
 * tree when there's no content dir or the index came back empty.
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
 * Pull selector: the full wp-content folder tree plus the database toggle.
 * Returns `undefined` when the user cancels (Escape / nothing selected) or
 * selects only the database (a database-only refresh isn't expressible against
 * the composite `pull` yet — we print guidance and the caller aborts).
 */
export async function selectPullItems(
	tree: TreeNode[],
	contentDir: string
): Promise< PullSelection | undefined > {
	if ( tree.length === 0 ) {
		return { fileOnlyPaths: [], skipDatabase: false, fullFileSelection: true, hasAnyFile: true };
	}

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
