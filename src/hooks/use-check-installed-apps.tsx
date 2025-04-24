import { useEffect } from 'react';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { fetchInstalledApps, selectInstalledApps } from 'src/stores/installed-apps-slice';

export function useCheckInstalledApps() {
	const dispatch = useAppDispatch();
	const installedApps = useRootSelector( selectInstalledApps );

	useEffect( () => {
		dispatch( fetchInstalledApps() );
	}, [ dispatch ] );

	return installedApps;
}
