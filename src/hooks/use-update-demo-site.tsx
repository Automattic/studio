import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState, createContext, useContext, useMemo, ReactNode } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useSnapshots } from './use-snapshots';

interface DemoSiteUpdateContextType {
	updateDemoSite: ( snapshot: Snapshot, localSite: SiteDetails ) => Promise< void >;
	isDemoSiteUpdating: ( siteId: string ) => boolean;
}

const DemoSiteUpdateContext = createContext< DemoSiteUpdateContextType >( {
	updateDemoSite: async () => undefined,
	isDemoSiteUpdating: () => false,
} );

interface DemoSiteUpdateProviderProps {
	children: ReactNode;
}

export const DemoSiteUpdateProvider: React.FC< DemoSiteUpdateProviderProps > = ( { children } ) => {
	const { client } = useAuth();
	const { __ } = useI18n();
	const [ updatingSites, setUpdatingSites ] = useState< Set< string > >( new Set() );
	const { updateSnapshot } = useSnapshots();

	const updateDemoSite = useCallback(
		async ( snapshot: Snapshot, localSite: SiteDetails ) => {
			if ( ! client ) {
				// No-op if logged out
				return;
			}
			setUpdatingSites( ( prev ) => new Set( prev ).add( localSite.id ) );

			try {
				const { zipContent } = await getIpcApi().archiveSite( localSite.id );
				const file = new File( [ zipContent ], 'loca-env-site-1.zip', {
					type: 'application/zip',
				} );

				const formData = [
					[ 'site_id', snapshot.atomicSiteId ],
					[ 'import', file ],
				];

				const wordpressVersion = await getIpcApi().getWpVersion( localSite.id );
				if ( wordpressVersion.length >= 3 ) {
					formData.push( [ 'wordpress_version', wordpressVersion ] );
				}

				const response = await client.req.post( {
					path: '/jurassic-ninja/update-site-from-zip',
					apiNamespace: 'wpcom/v2',
					formData,
				} );
				updateSnapshot( {
					...snapshot,
					date: new Date().getTime(),
				} );
				await getIpcApi().showNotification( {
					title: __( 'Update Successful' ),
					body: sprintf( __( "Demo site for '%s' has been updated." ), localSite.name ),
				} );
				return response;
			} catch ( error ) {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Update failed' ),
					message: sprintf(
						__( "We couldn't update the %s demo site. Please try again." ),
						localSite.name
					),
					error,
				} );
				Sentry.captureException( error );
			} finally {
				setUpdatingSites( ( prev ) => {
					const newSet = new Set( prev );
					newSet.delete( localSite.id );
					return newSet;
				} );
			}
		},
		[ __, client, updateSnapshot ]
	);

	const isDemoSiteUpdating = useCallback(
		( siteId: string ) => updatingSites.has( siteId ),
		[ updatingSites ]
	);

	const contextValue = useMemo(
		() => ( {
			updateDemoSite,
			isDemoSiteUpdating,
		} ),
		[ updateDemoSite, isDemoSiteUpdating ]
	);

	return (
		<DemoSiteUpdateContext.Provider value={ contextValue }>
			{ children }
		</DemoSiteUpdateContext.Provider>
	);
};

export const useUpdateDemoSite = () => {
	const context = useContext( DemoSiteUpdateContext );
	if ( context === null ) {
		throw new Error( 'useDemoSiteUpdate must be used within a DemoSiteUpdateProvider' );
	}
	return context;
};
