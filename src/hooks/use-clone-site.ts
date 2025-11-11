import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useSiteDetails } from 'src/hooks/use-site-details';

export function useCloneSite() {
	const { __ } = useI18n();
	const { data: sites } = useSiteDetails();
	const [ isCloning, setIsCloning ] = useState( false );
	const [ progress, setProgress ] = useState< CloneProgress | null >( null );
	const [ error, setError ] = useState< string | null >( null );

	const siteWithPathAlreadyExists = useCallback(
		async ( path: string ) => {
			const results = await Promise.all(
				sites.map( ( site ) => getIpcApi().comparePaths( site.path, path ) )
			);
			return results.some( Boolean );
		},
		[ sites ]
	);

	const cloneSite = useCallback(
		async ( sourceId: string, config: CloneSiteConfig ): Promise< SiteDetails | null > => {
			setIsCloning( true );
			setError( null );
			setProgress( null );

			try {
				// Validate path doesn't already exist
				if ( await siteWithPathAlreadyExists( config.newPath ) ) {
					throw new Error(
						__(
							'The directory is already associated with another Studio site. Please choose a different path.'
						)
					);
				}

				// Subscribe to progress events
				const unsubscribe = window.ipcListener.subscribe(
					'cloneSiteProgress',
					( _event, progressData ) => {
						setProgress( progressData );
					}
				);

				const result = await getIpcApi().cloneSite( sourceId, config );

				// Cleanup listener
				unsubscribe();

				return result;
			} catch ( err ) {
				const errorMessage =
					err instanceof Error ? err.message : __( 'Failed to clone site. Please try again.' );
				setError( errorMessage );
				return null;
			} finally {
				setIsCloning( false );
				setProgress( null );
			}
		},
		[ __, siteWithPathAlreadyExists ]
	);

	return {
		cloneSite,
		isCloning,
		progress,
		error,
		clearError: () => setError( null ),
	};
}
