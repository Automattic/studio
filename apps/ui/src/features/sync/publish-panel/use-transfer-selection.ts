import { PRESSABLE_PHP_VERSION } from '@studio/common/constants';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { presetOptions } from './options';
import {
	checkNodes,
	localNodes,
	remoteNodes,
	selectedNodes,
	syncOptions,
	updateNodes,
} from './selection';
import type { PublishScope, TransferDirection } from './options';
import type { SyncNode } from './selection';
import type { SiteDetails, SyncSite } from '@/data/core';

type Saved = { scope: PublishScope; nodes: SyncNode[]; content: boolean };
const EMPTY: Saved = { scope: 'all', nodes: [], content: false };

// Keeps what was ticked when the tree is fetched again.
function restoreSelection( entries: SyncNode[], previous: SyncNode[] ): SyncNode[] {
	return entries.map( ( entry ) => {
		const saved = previous.find( ( node ) => node.id === entry.id );
		return {
			...entry,
			checked: saved?.checked ?? false,
			indeterminate: saved?.indeterminate,
			children: entry.children
				? restoreSelection( entry.children, saved?.children ?? [] )
				: saved?.children,
		};
	} );
}

// What a push or pull to `remote` would include, remembered per website and
// direction for as long as the app runs.
export function useTransferSelection(
	site: SiteDetails,
	remote: SyncSite,
	direction: TransferDirection,
	enabled: boolean
) {
	const connector = useConnector();
	const client = useQueryClient();
	const savedKey = [ 'publish-selection', site.id, remote.id, direction ];
	const saved = useQuery( {
		queryKey: savedKey,
		queryFn: () => EMPTY,
		initialData: EMPTY,
		staleTime: Infinity,
		gcTime: Infinity,
	} ).data;
	const save = ( patch: ( current: Saved ) => Partial< Saved > ) =>
		client.setQueryData< Saved >( savedKey, ( current = EMPTY ) => ( {
			...current,
			...patch( current ),
		} ) );

	const tree = useQuery( {
		queryKey: [ 'publish-tree', site.id, remote.id, direction ],
		enabled,
		staleTime: 0,
		gcTime: 0,
		queryFn: async () => {
			let rewind: string | null = null;
			let nodes: SyncNode[];
			if ( direction === 'push' ) {
				nodes = localNodes( await connector.listLocalFileTree( site.id, 'wp-content', 3 ) );
			} else {
				rewind = await connector.getLatestRewindId( remote.id );
				if ( ! rewind ) {
					return { rewind, fullOnly: true };
				}
				nodes = remoteNodes(
					await connector.listRemoteFileTree( remote.id, rewind, '/wp-content/' ),
					'/wp-content/'
				);
			}
			save( ( current ) => ( { nodes: restoreSelection( nodes, current.nodes ) } ) );
			return { rewind, fullOnly: false };
		},
	} );

	const scope = tree.data?.fullOnly ? 'all' : saved.scope;
	const chosen = selectedNodes( saved.nodes );
	const options =
		scope === 'custom' ? syncOptions( saved.nodes, saved.content ) : presetOptions( scope );

	const versions = useQuery( {
		queryKey: [ 'publish-versions', site.id, remote.id ],
		enabled: enabled && direction === 'push',
		queryFn: async () => {
			const [ wp, php, multisite ] = await Promise.all( [
				connector.getWpVersion( site.id ),
				remote.isPressable ? PRESSABLE_PHP_VERSION : connector.getHostingPhpVersion( remote.id ),
				connector.getIsMultisite( site.id ),
			] );
			return { wp, php, multisite };
		},
	} );
	const size = useQuery( {
		queryKey: [
			'publish-size',
			site.id,
			scope,
			saved.content,
			chosen.map( ( node ) => node.path ),
		],
		enabled: enabled && direction === 'push' && tree.isSuccess,
		queryFn: async () => {
			if ( scope === 'all' ) {
				return connector.getDirectorySize( site.id, [ 'wp-content' ] );
			}
			const database = connector.getDirectorySize( site.id, [ 'wp-content', 'database' ] );
			if ( scope === 'content' ) {
				return database;
			}
			const files = ( scope === 'files' ? saved.nodes : chosen ).map( ( node ) =>
				node.folder
					? connector.getDirectorySize( site.id, node.path.split( '/' ) )
					: connector.getFileSize( site.id, node.path.split( '/' ) )
			);
			const sizes = await Promise.all(
				scope === 'custom' && saved.content ? [ database, ...files ] : files
			);
			return sizes.reduce( ( sum, value ) => sum + value, 0 );
		},
	} );

	const overLimit = ( size.data ?? 0 ) > SYNC_PUSH_SIZE_LIMIT_BYTES;
	const pushing = direction === 'push';
	let warning: string | undefined;
	if ( overLimit ) {
		warning = sprintf(
			/* translators: %s: the publishing size limit in GB */
			__( 'This selection exceeds the %s GB publishing limit. Choose fewer files to continue.' ),
			String( SYNC_PUSH_SIZE_LIMIT_GB )
		);
	} else if ( versions.data?.multisite && ! remote.isPressable ) {
		warning = __(
			'WordPress.com does not support multisite. Publishing this network may cause problems.'
		);
	}

	return {
		scope,
		setScope: ( value: PublishScope ) => save( () => ( { scope: value } ) ),
		nodes: saved.nodes,
		content: saved.content,
		setContent: ( content: boolean ) => save( () => ( { content } ) ),
		options,
		fullOnly: tree.data?.fullOnly === true,
		error: tree.error || size.error || versions.error,
		loading: tree.isFetching || ( pushing && ( size.isFetching || versions.isFetching ) ),
		loadingFiles: tree.isFetching && ! tree.data,
		loadingDetails:
			( tree.isFetching && ! tree.data ) || ( pushing && versions.isFetching && ! versions.data ),
		blocked: overLimit || ( scope === 'custom' && ! chosen.length && ! saved.content ),
		warning,
		retry: () => {
			void tree.refetch();
			if ( pushing ) {
				void size.refetch();
				void versions.refetch();
			}
		},
		change: ( id: string, checked: boolean ) =>
			save( ( current ) => ( {
				nodes: updateNodes( current.nodes, id, ( node ) => checkNodes( [ node ], checked )[ 0 ] ),
			} ) ),
		load: async ( node: SyncNode ) => {
			const children = pushing
				? localNodes( await connector.listLocalFileTree( site.id, node.path, 1 ) )
				: remoteNodes(
						await connector.listRemoteFileTree(
							remote.id,
							tree.data?.rewind ?? '',
							`${ node.path }/`
						),
						node.path
				  );
			save( ( current ) => ( {
				nodes: updateNodes( current.nodes, node.id, ( parent ) => ( {
					...parent,
					children: checkNodes( children, parent.checked ),
				} ) ),
			} ) );
		},
	};
}

export type TransferSelection = ReturnType< typeof useTransferSelection >;
