/**
 * Selective-sync prompts for `pull-reprint`.
 *
 * The file tree comes from the same WordPress.com backup API used by
 * `studio pull` and the Desktop UI. Reprint only receives the resulting
 * selected paths through `--only`.
 */
import { __ } from '@wordpress/i18n';
import { fetchLatestRewindId, fetchRemoteFileTree } from 'cli/lib/sync-api';
import { buildTreeFromRemote, fetchPullTree } from 'cli/lib/sync-selector';
import treeCheckbox from 'cli/lib/tree-checkbox';
import type { TreeNode } from 'cli/lib/tree-checkbox';

const WP_CONTENT_TOKEN = ':wp-content:';
const CONTENT_DIRECTORY_TOKENS: Record< string, string > = {
	':wp-plugins:': 'plugins',
	':wp-mu-plugins:': 'mu-plugins',
	':wp-uploads:': 'uploads',
};

export interface PullSelection {
	fileOnlyPaths: string[];
	skipDatabase: boolean;
	hasAnyFile: boolean;
}

/**
 * Resolve `--only` source values to absolute remote path prefixes for local
 * content preservation. Reprint itself resolves these values before pulling.
 */
export function resolveOnlyPathsToAbsolute(
	fileOnlyPaths: string[],
	contentDir: string
): string[] {
	const contentRoot = contentDir.replace( /\/+$/, '' );
	return fileOnlyPaths.map( ( source ) => {
		if ( source === WP_CONTENT_TOKEN || source.startsWith( `${ WP_CONTENT_TOKEN }/` ) ) {
			return `${ contentRoot }${ source.slice( WP_CONTENT_TOKEN.length ) }`;
		}
		for ( const [ token, directory ] of Object.entries( CONTENT_DIRECTORY_TOKENS ) ) {
			if ( source === token || source.startsWith( `${ token }/` ) ) {
				return `${ contentRoot }/${ directory }${ source.slice( token.length ) }`;
			}
		}
		return source;
	} );
}

function relativePathToOnly( value: string ): string {
	const relativePath = value.replace( /^wp-content(?:\/|$)/, '' ).replace( /\/+$/, '' );
	return relativePath ? `${ WP_CONTENT_TOKEN }/${ relativePath }` : WP_CONTENT_TOKEN;
}

/**
 * Map raw `--only` CLI values (wp-content-relative paths like
 * `plugins/akismet`, or pass-through Reprint tokens/absolute paths) to
 * Reprint `--only` sources.
 */
export function mapCliOnlyToReprint( values: string[] ): string[] {
	return values
		.map( ( value ) => value.trim() )
		.filter( ( value ) => value.length > 0 )
		.map( ( value ) => {
			if ( value.startsWith( ':' ) || value.startsWith( '/' ) ) {
				return value;
			}
			return relativePathToOnly( value );
		} );
}

/**
 * Reduce the checked nodes to Reprint flags, keeping each fully-selected
 * directory and dropping its descendants. A checked `wp-content` root means
 * every file is selected and no `--only` is needed.
 */
export function mapCheckedNodesToSelection( selected: TreeNode[] ): PullSelection {
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
		return slash < 0 || ! checkedValues.has( node.value.slice( 0, slash ) );
	} );

	return {
		fileOnlyPaths: maximal.map( ( node ) => relativePathToOnly( node.value ) ),
		skipDatabase,
		hasAnyFile: fileNodes.length > 0,
	};
}

/**
 * Jetpack represents directory paths with trailing slashes, which would
 * defeat the parent/child comparisons in {@link mapCheckedNodesToSelection}.
 * Canonicalize the values before the picker or the selection logic sees them.
 */
export function canonicalizeTreeValues( tree: TreeNode[] ): TreeNode[] {
	return tree.map( ( node ) => ( {
		...node,
		value: node.value.replace( /\/+$/, '' ),
		children: node.children ? canonicalizeTreeValues( node.children ) : undefined,
	} ) );
}

export async function fetchJetpackPullTree(
	token: string,
	remoteSiteId: number
): Promise< TreeNode[] > {
	const { tree } = await fetchPullTree( token, remoteSiteId );
	return canonicalizeTreeValues( tree );
}

/**
 * Prompt for what to pull. The existing pull command's Jetpack-backed tree
 * is expanded lazily, so the prompt never needs to materialize a remote file
 * index in Reprint state.
 */
export async function selectPullItems(
	tree: TreeNode[],
	options: { allowDatabaseOnly?: boolean; token?: string; remoteSiteId?: number } = {}
): Promise< PullSelection | undefined > {
	const selected = await treeCheckbox( {
		message: __( 'Select what to pull from the remote site' ),
		tree,
		onExpand:
			options.token && options.remoteSiteId
				? async ( node ) => {
						const rewindId = await fetchLatestRewindId( options.token!, options.remoteSiteId! );
						const entries = await fetchRemoteFileTree(
							options.token!,
							options.remoteSiteId!,
							rewindId,
							`/wp-content/${ node.value }`
						);
						return canonicalizeTreeValues( buildTreeFromRemote( entries, node.depth + 1 ) );
				  }
				: undefined,
	} );

	if ( selected.length === 0 ) {
		return undefined;
	}

	const selection = mapCheckedNodesToSelection( selected );
	if ( ! selection.hasAnyFile && ! options.allowDatabaseOnly ) {
		console.log(
			__(
				'Refreshing the database on its own is not supported yet. Select at least one file or folder to refresh.'
			)
		);
		return undefined;
	}

	return selection;
}
