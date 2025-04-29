import { useGetInstalledAppsQuery } from 'src/stores/installed-apps-slice';

export function useCheckInstalledApps() {
	// Use the RTK Query hook to fetch installed apps
	const { data: installedApps } = useGetInstalledAppsQuery();

	return installedApps;
}
