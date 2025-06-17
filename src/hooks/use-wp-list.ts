import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type WpListType = 'plugin' | 'theme';

const wpListCommands = {
	plugin: 'plugin list --format=json',
	theme: 'theme list --format=json',
};

export function useWpList( siteId: string, type: WpListType ) {
	const [ items, setItems ] = useState< string[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< Error | null >( null );

	useEffect( () => {
		async function fetchPlugins() {
			try {
				const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
					siteId,
					args: wpListCommands[ type ],
					skipPluginsAndThemes: true,
				} );

				if ( stderr ) {
					throw new Error( stderr );
				}

				const pluginList = JSON.parse( stdout );
				setItems( pluginList.map( ( plugin: { name: string } ) => plugin.name ) );
			} catch ( err ) {
				Sentry.captureException( err );
				setError( err instanceof Error ? err : new Error( `Failed to fetch ${ type }s` ) );
			} finally {
				setIsLoading( false );
			}
		}

		void fetchPlugins();
	}, [ siteId, type ] );

	return { items, isLoading, error };
}
