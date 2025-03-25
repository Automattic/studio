import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { generateCustomDomainFromSiteName, getDomainNameValidationError } from 'src/lib/domains';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	AllowedPHPVersion,
} from 'vendor/wp-now/src/constants';

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
	const [ phpVersion, setPhpVersion ] = useState< AllowedPHPVersion >(
		DEFAULT_PHP_VERSION as AllowedPHPVersion
	);
	const [ wpVersion, setWpVersion ] = useState( DEFAULT_WORDPRESS_VERSION );
	const [ useCustomDomain, setUseCustomDomain ] = useState( false );
	const [ customDomain, setCustomDomain ] = useState< string | null >( null );
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ existingDomainNames, setExistingDomainNames ] = useState< string[] >( [] );
	const [ enableHttps, setEnableHttps ] = useState( false );

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
		( path: string ) => {
			return sites.some( ( site ) => site.path.toLowerCase() === path.toLowerCase() );
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
				async ( newSite ) => {
					let updatedSite = { ...newSite };

					if ( newSite.phpVersion !== phpVersion ) {
						updatedSite = {
							...updatedSite,
							phpVersion,
						};
					}

					if ( newSite.wpVersion !== wpVersion ) {
						updatedSite = {
							...updatedSite,
							wpVersion,
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
					} else {
						await startServer( newSite.id );
					}

					getIpcApi().showNotification( {
						title: newSite.name,
						body: __( 'Your new site is up and running' ),
					} );
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
			useCustomDomain,
			setUseCustomDomain,
			customDomain,
			setCustomDomain: handleCustomDomainChange,
			customDomainError,
			setCustomDomainError,
			enableHttps,
			setEnableHttps,
			loadAllCustomDomains,
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
		useCustomDomain,
		setUseCustomDomain,
		customDomain,
		handleCustomDomainChange,
		customDomainError,
		setCustomDomainError,
		enableHttps,
		setEnableHttps,
		loadAllCustomDomains,
	] );
}
