import { useCallback } from 'react';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { appVersionSelectors, appVersionThunks } from 'src/stores/app-version-slice';

interface UseLastSeenVersion {
	lastSeenVersion: string | undefined;
	isNewVersion: boolean;
	updateLastSeenVersion: () => Promise< void >;
}

export function useLastSeenVersion(): UseLastSeenVersion {
	const dispatch = useAppDispatch();
	const currentVersion = window.appGlobals.appVersion;
	const lastSeenVersion = useRootSelector( appVersionSelectors.selectLastSeenVersion );
	const isNewVersion = useRootSelector( ( state ) =>
		appVersionSelectors.selectIsNewVersion( state, currentVersion || '' )
	);
	const updateLastSeenVersion = useCallback( async () => {
		if ( currentVersion ) {
			await dispatch( appVersionThunks.saveLastSeenVersion( currentVersion ) );
		}
	}, [ dispatch, currentVersion ] );

	return {
		lastSeenVersion,
		isNewVersion,
		updateLastSeenVersion,
	};
}
