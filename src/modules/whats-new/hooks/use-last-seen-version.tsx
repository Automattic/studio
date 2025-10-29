import { useCallback } from 'react';
import {
	useGetLastSeenVersionQuery,
	useSaveLastSeenVersionMutation,
	selectIsNewVersion,
} from 'src/stores/app-version-api';

interface UseLastSeenVersion {
	lastSeenVersion: string | undefined;
	isNewVersion: boolean;
	updateLastSeenVersion: () => Promise< void >;
}

export function useLastSeenVersion(): UseLastSeenVersion {
	const currentVersion = window.appGlobals.appVersion;
	const { lastSeenVersion, isNewVersion } = useGetLastSeenVersionQuery( undefined, {
		selectFromResult: ( result ) => ( {
			lastSeenVersion: result.data,
			isNewVersion:
				! result.isLoading &&
				! result.isFetching &&
				result.isSuccess &&
				selectIsNewVersion( result, currentVersion ),
		} ),
	} );
	const [ saveLastSeenVersion ] = useSaveLastSeenVersionMutation();

	const updateLastSeenVersion = useCallback( async () => {
		if ( currentVersion ) {
			await saveLastSeenVersion( currentVersion );
		}
	}, [ saveLastSeenVersion, currentVersion ] );

	return {
		lastSeenVersion,
		isNewVersion,
		updateLastSeenVersion,
	};
}
