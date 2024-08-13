import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useImportExport } from './use-import-export';
import { useSiteDetails } from './use-site-details';

export function useAddSite() {
	const { __ } = useI18n();
	const { createSite, data: sites, loadingSites, startServer, updateSite } = useSiteDetails();
	const { importFile, clearImportState } = useImportExport();
	const [ error, setError ] = useState( '' );
	const [ siteName, setSiteName ] = useState< string | null >( null );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ proposedSitePath, setProposedSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );
	const [ fileForImport, setFileForImport ] = useState< File | null >( null );

	const usedSiteNames = sites.map( ( site ) => site.name );

	const siteWithPathAlreadyExists = useCallback(
		( path: string ) => {
			return sites.some( ( site ) => site.path === path );
		},
		[ sites ]
	);

	const handlePathSelectorClick = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
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
	}, [ __, siteWithPathAlreadyExists, siteName, proposedSitePath ] );

	const handleAddSiteClick = useCallback( async () => {
		try {
			const path = sitePath ? sitePath : proposedSitePath;
			const newSite = await createSite( path, siteName ?? '' );
			if ( newSite ) {
				if ( fileForImport ) {
					await importFile( fileForImport, newSite, {
						showImportNotification: false,
						isNewSite: true,
					} );
					clearImportState( newSite.id );
				}
				await startServer( newSite.id );
				updateSite( { ...newSite, isAddingSite: false } );
				getIpcApi().showNotification( {
					title: newSite.name,
					body: __( 'Your new site is up and running' ),
				} );
			}
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
		updateSite,
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

	return useMemo(
		() => ( {
			handleAddSiteClick,
			handlePathSelectorClick,
			handleSiteNameChange,
			error: siteWithPathAlreadyExists( sitePath ? sitePath : proposedSitePath )
				? __(
						'Another site already exists at this path. Please select an empty directory to create a site.'
				  )
				: error,
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
			usedSiteNames,
			loadingSites,
			fileForImport,
			setFileForImport,
		} ),
		[
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
			usedSiteNames,
			loadingSites,
			fileForImport,
		]
	);
}
