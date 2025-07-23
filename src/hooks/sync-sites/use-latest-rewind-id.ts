import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { LatestRewindIdResponseSchema } from './types';

interface UseLatestRewindIdResult {
	rewindId: string | null;
	isLoading: boolean;
	error: Error | null;
}

export function useLatestRewindId( remoteSiteId: undefined | number ): UseLatestRewindIdResult {
	const { client } = useAuth();
	const [ rewindId, setRewindId ] = useState< string | null >( null );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< Error | null >( null );

	const fetchLatestRewindId = useCallback(
		async ( remoteSiteId: number ): Promise< string | null > => {
			if ( ! client ) {
				setError( new Error( 'No client available' ) );
				return null;
			}

			setIsLoading( true );
			setError( null );

			try {
				const rawResponse = await client.req.get(
					`/sites/${ remoteSiteId }/studio-app/sync/get-latest-rewind-id`,
					{
						apiNamespace: 'wpcom/v2',
					}
				);

				const validationResult = LatestRewindIdResponseSchema.safeParse( {
					body: rawResponse,
					status: 200,
					headers: [],
				} );

				if ( ! validationResult.success ) {
					console.error( 'Invalid response format:', validationResult.error );
					throw new Error( 'Invalid response format from server' );
				}

				const response = validationResult.data.body;

				if ( response.success && response.rewind_id ) {
					setRewindId( response.rewind_id );
					return response.rewind_id;
				}

				throw new Error( 'Failed to fetch latest rewind ID' );
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
				setError( new Error( errorMessage ) );
				return null;
			} finally {
				setIsLoading( false );
			}
		},
		[ client ]
	);

	useEffect( () => {
		if ( ! remoteSiteId ) {
			return;
		}
		void fetchLatestRewindId( remoteSiteId );
	}, [ fetchLatestRewindId, remoteSiteId ] );

	return {
		rewindId,
		isLoading,
		error,
	};
}
