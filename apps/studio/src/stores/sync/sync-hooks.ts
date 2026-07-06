import { useCallback, useState } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { useAuth } from 'src/hooks/use-auth';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { convertRawToTreeNodes } from 'src/modules/sync/lib/tree-utils';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { fetchRemoteFileTree, useGetLatestRewindIdQuery } from './sync-api';
import { syncSelectors } from './sync-slice';
import { useGetPhpVersionQuery } from './wpcom-sites';

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

export function useHostingPhpVersion(
	remoteSiteId: number | undefined,
	options?: {
		skip: boolean;
	}
) {
	const { skip = false } = options || {};
	const { user } = useAuth();

	const {
		data: phpVersion,
		isLoading,
		error,
	} = useGetPhpVersionQuery(
		{ siteId: remoteSiteId || 0, userId: user?.id },
		{
			skip: ! remoteSiteId || skip,
		}
	);

	return {
		phpVersion,
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
		): Promise< TreeNode[] > => {
			if ( ! client ) {
				return [];
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
				const errorMessage =
					err instanceof Error ? err.message : 'Failed to fetch remote file tree';
				throw new Error( errorMessage );
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
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< Error | null >( null );

	const fetchChildren = useCallback(
		async ( siteId: string, path: string = 'wp-content' ): Promise< TreeNode[] > => {
			setIsLoading( true );
			setError( null );
			try {
				const rawNodes = await getIpcApi().listLocalFileTree( siteId, path, 3 );
				return convertRawToTreeNodes( rawNodes );
			} catch ( err ) {
				const error = err instanceof Error ? err : new Error( String( err ) );
				setError( error );
				console.error( 'Failed to fetch local file tree:', error );
				return [];
			} finally {
				setIsLoading( false );
			}
		},
		[]
	);

	return {
		fetchChildren,
		isLoading,
		error,
	};
}
