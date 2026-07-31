/**
 * Selective-sync prompts for `pull-reprint`.
 *
 * Both first and subsequent pulls offer the full wp-content folder tree
 * plus a database toggle. reprint's `--only` is an *include* list that
 * replaces the default export roots, so on a first pull the caller must
 * add the preflight-detected core roots to a partial selection — the tree
 * itself only ever describes wp-content.
 *
 * `--only` accepts directories only (a file or symlink-to-file crashes the
 * remote exporter), so the tree is built from directories and symlinks that
 * resolve to directories, e.g. wp.com's per-plugin symlinks.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { SiteRuntime } from '@studio/common/lib/site-runtime';
import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import { __ } from '@wordpress/i18n';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';
import { getRemoteIndexPath, getReprintStatePath } from 'cli/lib/pull/reprint-state';
import { buildRootTree } from 'cli/lib/sync-selector';
import treeCheckbox from 'cli/lib/tree-checkbox';
import type { TreeNode } from 'cli/lib/tree-checkbox';

/** The well-known wp-content children that resolve to reprint path tokens. */
const CONTENT_DIR_TOKENS: Record< string, string > = {
	plugins: ':wp-plugins:',
	'mu-plugins': ':wp-mu-plugins:',
	uploads: ':wp-uploads:',
};

/** A selected wp-content entry that is a symlink on the remote. */
export interface SelectedSymlink {
	/** Absolute remote path of the symlink (e.g. …/wp-content/plugins/jetpack). */
	path: string;
	/** Absolute remote path of the symlink's target. */
	target: string;
}

export interface PullSelection {
	/** reprint `--only` source values; empty means "everything" (no `--only`). */
	fileOnlyPaths: string[];
	/** True when "Database" was unchecked. */
	skipDatabase: boolean;
	/** True when no part of the media library was selected. */
	skipUploads: boolean;
	/** False when only the database was selected. */
	hasAnyFile: boolean;
	/**
	 * Selected entries that are symlinks on the remote (wp.com serves each
	 * plugin as a symlink into a shared store). A scoped listing follows the
	 * link — its files arrive under the *target* path — but never lists the
	 * `--only` root itself, so the link must be recreated after the pull.
	 */
	symlinkPaths: SelectedSymlink[];
}

/**
 * Resolve `--only` source values (reprint tokens or absolute paths) to
 * absolute remote path prefixes. Tokens resolve to their conventional
 * location under the content dir, matching how the tree maps them.
 */
export function resolveOnlyPathsToAbsolute(
	fileOnlyPaths: string[],
	contentDir: string
): string[] {
	const contentRoot = contentDir.replace( /\/+$/, '' );
	return fileOnlyPaths.map( ( source ) => {
		for ( const [ name, token ] of Object.entries( CONTENT_DIR_TOKENS ) ) {
			if ( source === token || source.startsWith( `${ token }/` ) ) {
				return `${ contentRoot }/${ name }${ source.slice( token.length ) }`;
			}
		}
		return source;
	} );
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
 * indexed descendants (covers wp.com's per-plugin symlinks). Alongside
 * the tree, reports the kept nodes that are symlinks (node value →
 * absolute target path), so a selection can record links that need
 * recreating after a scoped pull.
 *
 * The index is streamed line-by-line and only directory/symlink entries
 * are retained (plus a set of directory prefixes) — never per-file
 * entries — so peak memory scales with the directory count, not the file
 * count (a media library with hundreds of thousands of uploads stays
 * cheap). The tree is capped with the shared `shouldLimitDepth` helper,
 * matching `push`: plugins/themes/mu-plugins stop at the individual
 * add-on and are not expanded into their files.
 */
async function parseIndexChildren(
	remoteIndexPath: string,
	contentDir: string
): Promise< { children: TreeNode[]; linkTargets: Record< string, string > } > {
	const contentRoot = contentDir.replace( /\/+$/, '' );
	const prefix = contentRoot + '/';

	// Directories only: dirPrefixes holds every path that has an indexed
	// descendant; dirEntries holds the `dir`/`link` entries (files are never
	// consulted by isDirectory, so they are dropped).
	const dirPrefixes = new Set< string >();
	const dirEntries = new Map< string, { type: string; target?: string } >();

	try {
		const rl = readline.createInterface( {
			input: fs.createReadStream( remoteIndexPath ),
			crlfDelay: Infinity,
		} );
		for await ( const line of rl ) {
			if ( ! line ) {
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

			const segments = absolutePath.split( '/' );
			for ( let i = 1; i < segments.length; i++ ) {
				dirPrefixes.add( segments.slice( 0, i ).join( '/' ) );
			}

			if ( entry.type === 'dir' || entry.type === 'link' ) {
				const target =
					typeof entry.target === 'string' && entry.target
						? Buffer.from( entry.target, 'base64' ).toString( 'utf-8' )
						: undefined;
				dirEntries.set( absolutePath, { type: entry.type, target } );
			}
		}
	} catch {
		return { children: [], linkTargets: {} };
	}

	const isDirectory = ( absolutePath: string ): boolean => {
		if ( dirPrefixes.has( absolutePath ) ) {
			return true;
		}
		const entry = dirEntries.get( absolutePath );
		if ( entry?.type === 'dir' ) {
			return true;
		}
		return entry?.type === 'link' && !! entry.target && dirPrefixes.has( entry.target );
	};

	// The wp-content directories to show: prefixes under wp-content, plus
	// `dir`/`link` entries that resolve to directories (e.g. per-plugin
	// symlinks, whose path has no indexed descendants of its own).
	const contentDirs = new Set< string >();
	for ( const dir of dirPrefixes ) {
		if ( dir.startsWith( prefix ) ) {
			contentDirs.add( dir );
		}
	}
	for ( const [ absolutePath, entry ] of dirEntries ) {
		if (
			absolutePath.startsWith( prefix ) &&
			( entry.type === 'dir' || isDirectory( absolutePath ) )
		) {
			contentDirs.add( absolutePath );
		}
	}

	const rootChildren: TreeNode[] = [];
	const byPath = new Map< string, TreeNode >();
	const linkTargets: Record< string, string > = {};

	for ( const absolutePath of contentDirs ) {
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
					isDirectory: true,
					checked: true,
					expanded: false,
					depth: i + 1,
					children: [],
				};
				byPath.set( currentRel, node );
				parentChildren.push( node );

				const entry = dirEntries.get( currentAbs );
				if ( entry?.type === 'link' && entry.target ) {
					linkTargets[ currentRel ] = entry.target;
				}
			}
			parentChildren = node.children!;

			// Stop at the first level inside plugins/themes/mu-plugins — you
			// select whole add-ons, not their files. Same cap as `push`.
			if ( shouldLimitDepth( currentRel ) ) {
				break;
			}
		}
	}

	return { children: finalizeNodes( rootChildren ), linkTargets };
}

/**
 * Build the selector tree (Database + wp-content) from reprint's remote
 * index. Empty when there's no content dir or no wp-content entries.
 */
export async function buildReprintTreeFromIndex(
	remoteIndexPath: string,
	contentDir: string | null
): Promise< { tree: TreeNode[]; linkTargets: Record< string, string > } > {
	if ( ! contentDir ) {
		return { tree: [], linkTargets: {} };
	}
	const { children, linkTargets } = await parseIndexChildren( remoteIndexPath, contentDir );
	if ( children.length === 0 ) {
		return { tree: [], linkTargets: {} };
	}
	return { tree: buildRootTree( children ), linkTargets };
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
 * The selected symlinks among a set of wp-content-relative values,
 * resolved to absolute link/target remote paths. Only the values passed
 * in matter — links *inside* a selected directory are listed by the
 * scoped index (as children) and recreated by reprint itself.
 */
export function selectedSymlinksFor(
	values: string[],
	contentDir: string,
	linkTargets: Record< string, string >
): SelectedSymlink[] {
	const contentRoot = contentDir.replace( /\/+$/, '' );
	return values
		.filter( ( value ) => linkTargets[ value ] )
		.map( ( value ) => ( {
			path: `${ contentRoot }/${ value }`,
			target: linkTargets[ value ],
		} ) );
}

/**
 * Reduce the flat list of checked nodes to the reprint flags, keeping each
 * fully-selected directory and dropping its descendants. A checked
 * `wp-content` root means everything is selected and no `--only` is needed.
 */
export function mapCheckedNodesToSelection(
	selected: TreeNode[],
	contentDir: string,
	linkTargets: Record< string, string > = {}
): PullSelection {
	const checkedValues = new Set( selected.map( ( node ) => node.value ) );
	const skipDatabase = ! checkedValues.has( 'database' );
	const skipUploads = ! [ ...checkedValues ].some(
		( value ) => value === 'wp-content' || value === 'uploads' || value.startsWith( 'uploads/' )
	);

	if ( checkedValues.has( 'wp-content' ) ) {
		return { fileOnlyPaths: [], skipDatabase, skipUploads, hasAnyFile: true, symlinkPaths: [] };
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
		skipUploads,
		hasAnyFile: fileNodes.length > 0,
		symlinkPaths: selectedSymlinksFor(
			maximal.map( ( node ) => node.value ),
			contentDir,
			linkTargets
		),
	};
}

interface FetchReprintPullTreeParams {
	stateDirectory: string;
	rawDirectory: string;
	contentDirectory: string | null;
	apiUrl: string;
	secret: string;
	runtime: SiteRuntime;
	verbose: boolean;
}

/**
 * Run `reprint files-index` (requires a prior preflight) and build the
 * selector tree from the resulting remote index.
 *
 * The index runs against a throwaway copy of the pull state: the
 * shared one must stay pristine, or the leftover remote index and
 * `files-index` checkpoint would derail the pull that follows — an
 * *initial* `pull-files` appends its scoped index to any existing file
 * and would fetch the entire site regardless of the selection.
 */
export async function fetchReprintPullTree( params: FetchReprintPullTreeParams ): Promise< {
	tree: TreeNode[];
	contentDir: string | null;
	linkTargets: Record< string, string >;
} > {
	const { stateDirectory, rawDirectory, contentDirectory, apiUrl, secret, runtime, verbose } =
		params;

	if ( ! contentDirectory ) {
		return { tree: [], contentDir: null, linkTargets: {} };
	}

	const indexStateDirectory = `${ stateDirectory.replace( /\/+$/, '' ) }-tree`;
	fs.rmSync( indexStateDirectory, { recursive: true, force: true } );
	fs.mkdirSync( path.dirname( getReprintStatePath( indexStateDirectory ) ), { recursive: true } );
	// files-index requires preflight data; hand it the session's copy.
	fs.copyFileSync(
		getReprintStatePath( stateDirectory ),
		getReprintStatePath( indexStateDirectory )
	);

	try {
		await runReprintCommandUntilComplete(
			indexStateDirectory,
			rawDirectory,
			[
				'files-index',
				apiUrl,
				`--secret=${ secret }`,
				'--no-adaptive',
				`--state-dir=${ indexStateDirectory }`,
				`--fs-root=${ rawDirectory }`,
			],
			undefined,
			{
				progressLabel: __( 'Scanning remote files' ),
				verboseCommands: verbose,
				runtime,
			}
		);

		const { tree, linkTargets } = await buildReprintTreeFromIndex(
			getRemoteIndexPath( indexStateDirectory ),
			contentDirectory
		);
		return { tree, contentDir: contentDirectory, linkTargets };
	} finally {
		fs.rmSync( indexStateDirectory, { recursive: true, force: true } );
	}
}

/**
 * Prompt for what to pull. Returns `undefined` when the user cancels.
 * A database-only choice is allowed only where the caller supports it
 * (first pull); on a delta re-pull `pull-files` needs at least one folder,
 * so guidance is printed and the caller aborts.
 */
export async function selectPullItems(
	tree: TreeNode[],
	contentDir: string,
	options: { allowDatabaseOnly?: boolean; linkTargets?: Record< string, string > } = {}
): Promise< PullSelection | undefined > {
	const selected = await treeCheckbox( {
		message: __( 'Select what to pull from the remote site' ),
		tree,
	} );

	if ( selected.length === 0 ) {
		return undefined;
	}

	const selection = mapCheckedNodesToSelection( selected, contentDir, options.linkTargets ?? {} );

	if ( ! selection.hasAnyFile && ! options.allowDatabaseOnly ) {
		console.log(
			__(
				'Refreshing the database on its own is not supported yet. Select at least one folder to refresh.'
			)
		);
		return undefined;
	}

	return selection;
}
