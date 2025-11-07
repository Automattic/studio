import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { generateCustomDomainFromSiteName, getDomainNameValidationError } from 'src/lib/domains';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { AllowedPHPVersion } from 'src/lib/wordpress-provider/constants';
import { useRootSelector } from 'src/stores';
import {
	selectDefaultPhpVersion,
	selectDefaultWordPressVersion,
} from 'src/stores/provider-constants-slice';
import { useConnectedSitesOperations } from 'src/stores/sync';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import type { Blueprint } from 'src/stores/wpcom-api';
import type { SyncOption } from 'src/types';

export function useAddSite() {
	const { __ } = useI18n();
	const { createSite, data: sites, loadingSites, startServer, updateSite } = useSiteDetails();
	const { importFile, clearImportState } = useImportExport();
	const { connectSite } = useConnectedSitesOperations();
	const { pullSite } = useSyncSites();
	const { setSelectedTab } = useContentTabs();
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );
	const [ error, setError ] = useState( '' );
	const [ siteName, setSiteName ] = useState< string | null >( null );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ proposedSitePath, setProposedSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );
	const [ fileForImport, setFileForImport ] = useState< File | null >( null );
	const [ phpVersion, setPhpVersion ] = useState< AllowedPHPVersion >(
		defaultPhpVersion as AllowedPHPVersion
	);
	const [ wpVersion, setWpVersion ] = useState( defaultWordPressVersion );
	const [ useCustomDomain, setUseCustomDomain ] = useState( false );
	const [ customDomain, setCustomDomain ] = useState< string | null >( null );
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ existingDomainNames, setExistingDomainNames ] = useState< string[] >( [] );
	const [ enableHttps, setEnableHttps ] = useState( false );
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< Blueprint | undefined >();
	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | undefined >();

	const loadAllCustomDomains = useCallback( () => {
		getIpcApi()
			.getAllCustomDomains()
			.then( ( domains ) => {
				setExistingDomainNames( domains );
			} )
			.catch( () => {
				// Do nothing
			} );
	}, [] );

	const siteWithPathAlreadyExists = useCallback(
		async ( path: string ) => {
			const results = await Promise.all(
				sites.map( ( site ) => getIpcApi().comparePaths( site.path, path ) )
			);
			return results.some( Boolean );
		},
		[ sites ]
	);

	const handleCustomDomainChange = useCallback(
		( value: string | null ) => {
			setCustomDomain( value );
			setCustomDomainError(
				getDomainNameValidationError( useCustomDomain, value, existingDomainNames )
			);
		},
		[ useCustomDomain, setCustomDomain, setCustomDomainError, existingDomainNames ]
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
			if ( await siteWithPathAlreadyExists( path ) ) {
				setError(
					__(
						'The directory is already associated with another Studio site. Please choose a different custom local path.'
					)
				);
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
			let usedCustomDomain = useCustomDomain && customDomain ? customDomain : undefined;
			if ( useCustomDomain && ! customDomain ) {
				usedCustomDomain = generateCustomDomainFromSiteName( siteName ?? '' );
			}
			await createSite(
				path,
				siteName ?? '',
				wpVersion,
				usedCustomDomain,
				useCustomDomain ? enableHttps : false,
				selectedBlueprint,
				async ( newSite ) => {
					let updatedSite = { ...newSite };

					if ( newSite.phpVersion !== phpVersion ) {
						updatedSite = {
							...updatedSite,
							phpVersion,
						};
					}

					if ( updatedSite !== newSite ) {
						await updateSite( updatedSite );
					}

					if ( fileForImport ) {
						await importFile( fileForImport, newSite, {
							showImportNotification: false,
							isNewSite: true,
						} );
						clearImportState( newSite.id );

						getIpcApi().showNotification( {
							title: newSite.name,
							body: __( 'Your new site was imported' ),
						} );
					} else {
						if ( selectedRemoteSite ) {
							await connectSite( selectedRemoteSite, newSite.id );
							const pullOptions: SyncOption[] = [ 'all' ];
							pullSite( selectedRemoteSite, newSite, {
								optionsToSync: pullOptions,
							} );
							setSelectedTab( 'sync' );
						} else {
							await startServer( newSite.id );

							getIpcApi().showNotification( {
								title: newSite.name,
								body: __( 'Your new site was created' ),
							} );
						}
					}
				}
			);
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
		wpVersion,
		phpVersion,
		customDomain,
		useCustomDomain,
		enableHttps,
		selectedBlueprint,
		selectedRemoteSite,
		pullSite,
		connectSite,
		setSelectedTab,
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

			if ( await siteWithPathAlreadyExists( proposedPath ) ) {
				setError(
					__(
						'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
					)
				);
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
		return {
			handleAddSiteClick,
			handlePathSelectorClick,
			handleSiteNameChange,
			error,
			sitePath: sitePath ? sitePath : proposedSitePath,
			siteName,
			doesPathContainWordPress,
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
			useCustomDomain,
			setUseCustomDomain,
			customDomain,
			setCustomDomain: handleCustomDomainChange,
			customDomainError,
			setCustomDomainError,
			enableHttps,
			setEnableHttps,
			loadAllCustomDomains,
			selectedBlueprint,
			setSelectedBlueprint,
			selectedRemoteSite,
			setSelectedRemoteSite,
		};
	}, [
		doesPathContainWordPress,
		error,
		handleAddSiteClick,
		handlePathSelectorClick,
		handleSiteNameChange,
		siteName,
		sitePath,
		proposedSitePath,
		sites,
		loadingSites,
		fileForImport,
		phpVersion,
		wpVersion,
		useCustomDomain,
		setUseCustomDomain,
		customDomain,
		handleCustomDomainChange,
		customDomainError,
		setCustomDomainError,
		enableHttps,
		setEnableHttps,
		loadAllCustomDomains,
		selectedBlueprint,
		setSelectedBlueprint,
		selectedRemoteSite,
		setSelectedRemoteSite,
	] );
}
