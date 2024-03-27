import { createContext, useContext, useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

const initState = {
	vscode: false,
	phpstorm: false,
};
const checkInstalledAppsContext = createContext< InstalledApps >( initState );

interface InstalledAppsProviderProps {
	children?: React.ReactNode;
}

export function useCheckInstalledApps() {
	return useContext( checkInstalledAppsContext );
}

export function InstalledAppsProvider( { children }: InstalledAppsProviderProps ) {
	const { Provider } = checkInstalledAppsContext;

	const [ installedApps, setInstalledApps ] = useState< InstalledApps >( initState );
	useEffect( () => {
		let cancel = false;
		getIpcApi()
			.getInstalledApps()
			.then( ( installedApps ) => {
				if ( ! cancel ) {
					setInstalledApps( installedApps );
				}
			} );

		return () => {
			cancel = true;
		};
	}, [] );
	return <Provider value={ installedApps }>{ children }</Provider>;
}
