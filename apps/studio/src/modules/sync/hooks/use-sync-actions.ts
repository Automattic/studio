import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';
import { useAppDispatch } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import type { SyncSite } from '@studio/common/types/sync';
import type { TreeNode } from 'src/components/tree-view';

/**
 * Hook wrapping the existing push/pull thunks so the TriangleLayout can trigger them
 * without reimplementing the sync-options dialog flow.
 *
 * The returned `push`/`pull` functions set `pendingSyncTarget` to open the SyncDialog;
 * that dialog then calls `commitPush`/`commitPull` with the selected tree.
 */
export function useSyncActions( selectedSite: SiteDetails ) {
	const dispatch = useAppDispatch();
	const { client } = useAuth();
	const [ pendingSyncTarget, setPendingSyncTarget ] = useState< {
		connectedSite: SyncSite;
		direction: 'push' | 'pull';
	} | null >( null );

	const push = useCallback( async ( connectedSite: SyncSite ) => {
		// Guardrail: pushes to production overwrite the live site — always confirm.
		const isProduction =
			connectedSite.environmentType === 'production' && ! connectedSite.isStaging;
		if ( isProduction ) {
			const confirmed = window.confirm(
				sprintf(
					/* translators: %s: production site URL */
					__(
						'This will overwrite the content of %s with your local changes. Are you sure you want to continue?'
					),
					connectedSite.url
				)
			);
			if ( ! confirmed ) {
				return;
			}
		}
		setPendingSyncTarget( { connectedSite, direction: 'push' } );
	}, [] );
	const pull = useCallback(
		( connectedSite: SyncSite ) => setPendingSyncTarget( { connectedSite, direction: 'pull' } ),
		[]
	);

	const commitPush = useCallback(
		( tree: TreeNode[] ) => {
			if ( ! pendingSyncTarget ) return;
			const options = convertTreeToPushOptions( tree );
			void dispatch(
				syncOperationsThunks.pushSite( {
					connectedSite: pendingSyncTarget.connectedSite,
					selectedSite,
					options,
				} )
			);
		},
		[ dispatch, pendingSyncTarget, selectedSite ]
	);

	const commitPull = useCallback(
		( tree: TreeNode[] ) => {
			if ( ! pendingSyncTarget || ! client ) return;
			const options = convertTreeToPullOptions( tree );
			void dispatch(
				syncOperationsThunks.pullSite( {
					client,
					connectedSite: pendingSyncTarget.connectedSite,
					selectedSite,
					options,
				} )
			);
		},
		[ client, dispatch, pendingSyncTarget, selectedSite ]
	);

	const closeDialog = useCallback( () => setPendingSyncTarget( null ), [] );

	return { push, pull, pendingSyncTarget, commitPush, commitPull, closeDialog };
}
