import { useCallback } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { useAuth } from 'src/hooks/use-auth';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { fetchRemoteFileTree, useGetLatestRewindIdQuery } from './sync-api';
import { syncSelectors } from './sync-slice';

export function useLatestRewindId(
	remoteSiteId: number | undefined,
	options?: {
		skip: boolean;
	}
) {
	const { skip = false } = options || {};

	const {
		data: rewindId,
		isLoading,
		error,
	} = useGetLatestRewindIdQuery( remoteSiteId || 0, {
		skip: ! remoteSiteId || skip,
	} );

	return {
		rewindId: rewindId || null,
		isLoading,
		isError: Boolean( error ),
	};
}

export function useRemoteFileTree() {
	const dispatch = useAppDispatch();
	const { client } = useAuth();
	const isLoading = useRootSelector( syncSelectors.selectIsLoadingFileTree );
	const error = useRootSelector( syncSelectors.selectFileTreeError );

	const fetchChildren = useCallback(
		async (
			remoteSiteId: number,
			rewindId: string,
			path: string,
			parentChecked: boolean = false
		): Promise< TreeNode[] | null > => {
			if ( ! client ) {
				return null;
			}

			try {
				const result = await dispatch(
					fetchRemoteFileTree( {
						client,
						remoteSiteId,
						rewindId,
						path,
						parentChecked,
					} )
				).unwrap();

				return result.children;
			} catch ( err ) {
				console.error( 'Failed to fetch remote file tree:', err );
				return null;
			}
		},
		[ client, dispatch ]
	);

	return {
		isLoading,
		error: error ? new Error( error ) : null,
		fetchChildren,
	};
}

export function useLocalFileTree() {
	const fetchChildren = useCallback(
		async (
			siteId: string,
			path: string,
			parentChecked: boolean = false
		): Promise< TreeNode[] | null > => {
			try {
				const result = await getIpcApi().listLocalFileTree( siteId, path, parentChecked );
				return result;
			} catch ( err ) {
				console.error( 'Failed to fetch local file tree:', err );
				return null;
			}
		},
		[]
	);

	return {
		fetchChildren,
	};
}
