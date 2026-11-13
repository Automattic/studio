import { getProviderSites, type RemoteSite, type SitesProviderId } from '@studio/providers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
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
import type { SiteDetails } from '@/data/core';

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
	provider: SitesProviderId,
	remote: RemoteSite,
	direction: TransferDirection,
	enabled: boolean,
	forceEntireSite = false,
	draftSelection?: Saved
) {
	const connector = useConnector();
	const sites = getProviderSites( provider );
	const client = useQueryClient();
	const savedKey = [ 'publish-selection', site.id, provider, remote.id, direction ];
	const [ draft, setDraft ] = useState( draftSelection );
	const committed = useQuery( {
		queryKey: savedKey,
		queryFn: () => EMPTY,
		initialData: EMPTY,
		staleTime: Infinity,
		gcTime: Infinity,
	} ).data;
	const saved = draft ?? committed;
	const save = ( patch: ( current: Saved ) => Partial< Saved > ) => {
		const apply = ( current = EMPTY ) => ( { ...current, ...patch( current ) } );
		if ( draftSelection ) setDraft( apply );
		else client.setQueryData< Saved >( savedKey, apply );
	};

	const tree = useQuery( {
		queryKey: [ 'publish-tree', site.id, provider, remote.id, direction, !! draftSelection ],
		// Without selective sync, everything goes, so there's nothing to pick from.
		enabled: enabled && sites.selective,
		staleTime: 0,
		gcTime: 0,
		queryFn: async () => {
			let rewind: string | null = null;
			let nodes: SyncNode[];
			if ( direction === 'push' ) {
				nodes = localNodes( await connector.listLocalFileTree( site.id, 'wp-content', 3 ) );
			} else {
				// Individual files can only be browsed when the website has a backup.
				rewind =
					sites.hasBackups?.( remote ) === false
						? null
						: await connector.getRemoteBackupId( provider, remote.id );
				if ( ! rewind ) {
					return { rewind, filesUnavailable: true };
				}
				nodes = remoteNodes(
					await connector.listRemoteBackupFiles( provider, remote.id, rewind, '/wp-content/' ),
					'/wp-content/'
				);
			}
			save( ( current ) => ( { nodes: restoreSelection( nodes, current.nodes ) } ) );
			return { rewind, filesUnavailable: false };
		},
	} );

	const scope =
		forceEntireSite || ( tree.data?.filesUnavailable && saved.scope === 'custom' )
			? 'all'
			: saved.scope;
	const chosen = selectedNodes( saved.nodes );
	const options =
		scope === 'custom' ? syncOptions( saved.nodes, saved.content ) : presetOptions( scope );

	const multisite = useQuery( {
		queryKey: [ 'publish-multisite', site.id ],
		enabled: enabled && ! draftSelection && direction === 'push' && Boolean( sites.pushWarning ),
		queryFn: async () => ( await connector.getIsMultisite( site.id ) ) ?? null,
	} );
	const size = useQuery( {
		queryKey: [
			'publish-size',
			site.id,
			scope,
			saved.content,
			chosen.map( ( node ) => node.path ),
		],
		enabled: enabled && ! draftSelection && direction === 'push' && tree.isSuccess,
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

	const overLimit = sites.maxPushSize !== undefined && ( size.data ?? 0 ) > sites.maxPushSize;
	const pushing = direction === 'push';
	let warning: string | undefined;
	if ( overLimit ) {
		warning = sprintf(
			/* translators: %s: the publishing size limit in GB */
			forceEntireSite
				? __( 'Your WordPress exceeds the %s GB publishing limit.' )
				: __(
						'This selection exceeds the %s GB publishing limit. Choose fewer files to continue.'
				  ),
			String( sites.maxPushSize! / 1024 ** 3 )
		);
	} else if ( pushing ) {
		warning =
			sites.pushWarning?.( remote, { multisite: multisite.data ?? undefined } ) ?? undefined;
	}

	return {
		scope,
		snapshot: saved,
		restore: ( snapshot: Saved ) => save( () => snapshot ),
		setScope: ( value: PublishScope ) => save( () => ( { scope: value } ) ),
		nodes: saved.nodes,
		content: saved.content,
		setContent: ( content: boolean ) => save( () => ( { content } ) ),
		options,
		filesUnavailable: tree.data?.filesUnavailable === true,
		error: tree.error || size.error || multisite.error,
		loading: tree.isFetching || ( pushing && ( size.isFetching || multisite.isFetching ) ),
		loadingFiles: tree.isFetching && ! tree.data,
		loadingDetails:
			( tree.isFetching && ! tree.data ) ||
			( pushing && multisite.isFetching && ! multisite.isSuccess ),
		blocked: overLimit || ( scope === 'custom' && ! chosen.length && ! saved.content ),
		warning,
		retry: () => {
			void tree.refetch();
			if ( pushing ) {
				void size.refetch();
				void multisite.refetch();
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
						await connector.listRemoteBackupFiles(
							provider,
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
