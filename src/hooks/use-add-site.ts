import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';

export function useAddSite() {
	const { __ } = useI18n();
	const { createSite, data: sites, loadingSites, startServer } = useSiteDetails();
	const { importFile, clearImportState } = useImportExport();
	const [ error, setError ] = useState( '' );
	const [ siteName, setSiteName ] = useState< string | null >( null );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ proposedSitePath, setProposedSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );
	const [ fileForImport, setFileForImport ] = useState< File | null >( null );
	const [ phpVersion, setPhpVersion ] = useState< string >( '' );
	const [ wpVersion, setWpVersion ] = useState( DEFAULT_WORDPRESS_VERSION );

	const siteWithPathAlreadyExists = useCallback(
		( path: string ) => {
			return sites.some( ( site ) => site.path.toLowerCase() === path.toLowerCase() );
		},
		[ sites ]
	);

	const handlePathSelectorClick = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog(
			__( 'Choose folder for site' ),
			sitePath
		);
		if ( response?.path ) {
			const { path, name, isEmpty, isWordPress } = response;
			setDoesPathContainWordPress( false );
			setError( '' );
			const pathResetToDefaultSitePath =
				path === proposedSitePath.substring( 0, proposedSitePath.lastIndexOf( '/' ) );

			setSitePath( pathResetToDefaultSitePath ? '' : path );
			if ( siteWithPathAlreadyExists( path ) ) {
				return;
			}
			if ( ! isEmpty && ! isWordPress && ! pathResetToDefaultSitePath ) {
				setError(
					__(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					)
				);
				return;
			}
			setDoesPathContainWordPress( ! isEmpty && isWordPress );
			if ( ! siteName ) {
				setSiteName( name ?? null );
			}
		}
	}, [ __, siteWithPathAlreadyExists, siteName, proposedSitePath, sitePath ] );

	const handleAddSiteClick = useCallback( async () => {
		try {
			const path = sitePath ? sitePath : proposedSitePath;
			await createSite( path, siteName ?? '', wpVersion, async ( newSite ) => {
				if ( newSite ) {
					if ( fileForImport ) {
						await importFile( fileForImport, newSite, {
							showImportNotification: false,
							isNewSite: true,
						} );
						clearImportState( newSite.id );
					} else {
						// when we import file we start the server automatically, so doesn't make sense to run it again, to avoid unexpected behaviour
						await startServer( newSite.id );
					}

					getIpcApi().showNotification( {
						title: newSite.name,
						body: __( 'Your new site is up and running' ),
					} );
				}
			} );
		} catch ( e ) {
			Sentry.captureException( e );
		}
	}, [
		__,
		clearImportState,
		createSite,
		fileForImport,
		importFile,
		proposedSitePath,
		siteName,
		sitePath,
		startServer,
		wpVersion,
	] );

	const handleSiteNameChange = useCallback(
		async ( name: string ) => {
			setSiteName( name );
			if ( sitePath ) {
				return;
			}
			setError( '' );
			const {
				path: proposedPath,
				isEmpty,
				isWordPress,
			} = await getIpcApi().generateProposedSitePath( name );
			setProposedSitePath( proposedPath );

			if ( siteWithPathAlreadyExists( proposedPath ) ) {
				return;
			}
			if ( ! isEmpty && ! isWordPress ) {
				setError(
					__(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					)
				);
				return;
			}
			setDoesPathContainWordPress( ! isEmpty && isWordPress );
		},
		[ __, sitePath, siteWithPathAlreadyExists ]
	);

	return useMemo( () => {
		let errorPathIsNotAvailable;
		if ( siteWithPathAlreadyExists( sitePath ? sitePath : proposedSitePath ) ) {
			if ( sitePath ) {
				errorPathIsNotAvailable = __(
					'The directory is already associated with another Studio site. Please choose a different custom local path.'
				);
			} else {
				errorPathIsNotAvailable = __(
					'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
				);
			}
		}

		return {
			handleAddSiteClick,
			handlePathSelectorClick,
			handleSiteNameChange,
			error: errorPathIsNotAvailable || error,
			sitePath: sitePath ? sitePath : proposedSitePath,
			siteName,
			doesPathContainWordPress,
			siteWithPathAlreadyExists,
			setSiteName,
			proposedSitePath,
			setProposedSitePath,
			setSitePath,
			setError,
			setDoesPathContainWordPress,
			sites,
			loadingSites,
			fileForImport,
			setFileForImport,
			phpVersion,
			setPhpVersion,
			wpVersion,
			setWpVersion,
		};
	}, [
		__,
		doesPathContainWordPress,
		error,
		handleAddSiteClick,
		handlePathSelectorClick,
		siteWithPathAlreadyExists,
		handleSiteNameChange,
		siteName,
		sitePath,
		proposedSitePath,
		sites,
		loadingSites,
		fileForImport,
		phpVersion,
		wpVersion,
	] );
}
