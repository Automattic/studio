import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState, createContext, useContext, useMemo, ReactNode } from 'react';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface DemoSiteUpdateContextType {
	updateDemoSite: ( snapshot: Snapshot, localSite: SiteDetails ) => Promise< void >;
	isDemoSiteUpdating: ( atomicSiteId: number ) => boolean;
	hasDemoSiteError: ( atomicSiteId: number ) => boolean;
}

const DemoSiteUpdateContext = createContext< DemoSiteUpdateContextType >( {
	updateDemoSite: async () => undefined,
	isDemoSiteUpdating: () => false,
	hasDemoSiteError: () => false,
} );

interface DemoSiteUpdateProviderProps {
	children: ReactNode;
}

export const DemoSiteUpdateProvider: React.FC< DemoSiteUpdateProviderProps > = ( { children } ) => {
	const { client } = useAuth();
	const { __ } = useI18n();
	const [ updatingSites, setUpdatingSites ] = useState< Set< number > >( new Set() );
	const [ errorSites, setErrorSites ] = useState< Set< number > >( new Set() );
	const { updateSnapshot } = useSnapshots();

	const updateDemoSite = useCallback(
		async ( snapshot: Snapshot, localSite: SiteDetails ) => {
			if ( ! client ) {
				// No-op if logged out
				return;
			}
			setUpdatingSites( ( prev ) => new Set( prev ).add( snapshot.atomicSiteId ) );
			// Clear error when user retries
			if ( errorSites.has( snapshot.atomicSiteId ) ) {
				setErrorSites( ( prev ) => {
					const next = new Set( prev );
					next.delete( snapshot.atomicSiteId );
					return next;
				} );
			}

			let archivePath = '';
			try {
				const { archivePath: tempArchivePath, archiveSizeInBytes } = await getIpcApi().archiveSite(
					localSite.id,
					'zip'
				);
				archivePath = tempArchivePath;

				if ( archiveSizeInBytes > DEMO_SITE_SIZE_LIMIT_BYTES ) {
					void getIpcApi().showErrorMessageBox( {
						title: __( 'Updating preview site failed' ),
						message: sprintf(
							__(
								'The site exceeds the maximum size of %dGB. Please remove some files and try again.'
							),
							DEMO_SITE_SIZE_LIMIT_GB
						),
					} );

					setUpdatingSites( ( prev ) => {
						const newSet = new Set( prev );
						newSet.delete( snapshot.atomicSiteId );
						return newSet;
					} );
					void getIpcApi().removeTemporalFile( archivePath );
					return;
				}

				const file = new File(
					[ await getIpcApi().getFileContent( archivePath ) ],
					'loca-env-site-1.zip',
					{
						type: 'application/zip',
					}
				);

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
					body: sprintf( __( "Preview site for '%s' has been updated." ), localSite.name ),
				} );
				return response;
			} catch ( error ) {
				setErrorSites( ( prev ) => new Set( prev ).add( snapshot.atomicSiteId ) );
				void getIpcApi().showErrorMessageBox( {
					title: __( 'Update failed' ),
					message: sprintf(
						__( "We couldn't update the %s preview site. Please try again." ),
						localSite.name
					),
					error,
				} );
				Sentry.captureException( error );
			} finally {
				setUpdatingSites( ( prev ) => {
					const next = new Set( prev );
					next.delete( snapshot.atomicSiteId );
					return next;
				} );
				if ( archivePath ) {
					void getIpcApi().removeTemporalFile( archivePath );
				}
			}
		},
		[ __, client, errorSites, updateSnapshot ]
	);

	const isDemoSiteUpdating = useCallback(
		( atomicSiteId: number ) => updatingSites.has( atomicSiteId ),
		[ updatingSites ]
	);

	const hasDemoSiteError = useCallback(
		( atomicSiteId: number ) => errorSites.has( atomicSiteId ),
		[ errorSites ]
	);

	const contextValue = useMemo(
		() => ( {
			updateDemoSite,
			isDemoSiteUpdating,
			hasDemoSiteError,
		} ),
		[ updateDemoSite, isDemoSiteUpdating, hasDemoSiteError ]
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
