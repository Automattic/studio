import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { generateCustomDomainFromSiteName } from 'common/lib/domains';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { AllowedPHPVersion } from 'src/lib/wordpress-provider/constants';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';
import { useRootSelector } from 'src/stores';
import {
	selectDefaultPhpVersion,
	selectDefaultWordPressVersion,
} from 'src/stores/provider-constants-slice';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import type { SyncSite } from 'src/modules/sync/types';
import type { Blueprint } from 'src/stores/wpcom-api';
import type { SyncOption } from 'src/types';

/**
 * Form values passed when creating a site
 */
export interface CreateSiteFormValues {
	siteName: string;
	sitePath: string;
	phpVersion: AllowedPHPVersion;
	wpVersion: string;
	useCustomDomain: boolean;
	customDomain: string | null;
	enableHttps: boolean;
}

/**
 * Result from path selection or site name change validation
 */
export interface PathValidationResult {
	path: string;
	name?: string;
	isEmpty: boolean;
	isWordPress: boolean;
	error?: string;
}

interface UseAddSiteOptions {
	openModal?: () => void;
}

export function useAddSite( options: UseAddSiteOptions = {} ) {
	const { openModal = () => {} } = options;
	const { __ } = useI18n();
	const { createSite, sites, startServer } = useSiteDetails();
	const { importFile, clearImportState, importState } = useImportExport();
	const [ connectSite ] = useConnectSiteMutation();
	const { pullSite } = useSyncSites();
	const { setSelectedTab } = useContentTabs();
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );

	// Only keep state that's NOT part of the form
	const [ fileForImport, setFileForImport ] = useState< File | null >( null );
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< Blueprint | undefined >();
	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | undefined >();
	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		{ php?: string; wp?: string } | undefined
	>();
	const [ blueprintDeeplinkWarnings, setBlueprintDeeplinkWarnings ] = useState<
		BlueprintValidationWarning[] | undefined
	>();
	const [ isDeeplinkFlow, setIsDeeplinkFlow ] = useState( false );
	const [ existingDomainNames, setExistingDomainNames ] = useState< string[] >( [] );

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const clearDeeplinkState = useCallback( () => {
		setIsDeeplinkFlow( false );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintDeeplinkWarnings( undefined );
	}, [] );

	// For blueprint deeplinks - we need temporary state for PHP/WP versions
	const [ deeplinkPhpVersion, setDeeplinkPhpVersion ] = useState< AllowedPHPVersion >(
		defaultPhpVersion as AllowedPHPVersion
	);
	const [ deeplinkWpVersion, setDeeplinkWpVersion ] = useState( defaultWordPressVersion );

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		openModal,
		setSelectedBlueprint,
		setPhpVersion: setDeeplinkPhpVersion,
		setWpVersion: setDeeplinkWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		navigateToBlueprintDeeplink: () => setIsDeeplinkFlow( true ),
	} );

	const resetForm = useCallback( () => {
		setFileForImport( null );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintDeeplinkWarnings( undefined );
		setSelectedRemoteSite( undefined );
		setDeeplinkPhpVersion( defaultPhpVersion as AllowedPHPVersion );
		setDeeplinkWpVersion( defaultWordPressVersion );
		clearDeeplinkState();
	}, [ clearDeeplinkState, defaultPhpVersion, defaultWordPressVersion ] );

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

	/**
	 * Check if a path is already associated with an existing site
	 */
	const checkPathExists = useCallback(
		async ( path: string ): Promise< boolean > => {
			const results = await Promise.all(
				sites.map( ( site ) => getIpcApi().comparePaths( site.path, path ) )
			);
			return results.some( Boolean );
		},
		[ sites ]
	);

	/**
	 * Open folder picker and validate the selected path
	 * Returns the result for the form to use
	 */
	const selectPath = useCallback(
		async ( currentPath: string ): Promise< PathValidationResult | null > => {
			const response = await getIpcApi().showOpenFolderDialog(
				__( 'Choose folder for site' ),
				currentPath
			);

			if ( ! response?.path ) {
				return null;
			}

			const { path, name, isEmpty, isWordPress } = response;

			if ( await checkPathExists( path ) ) {
				return {
					path,
					name: name ?? undefined,
					isEmpty,
					isWordPress,
					error: __(
						'The directory is already associated with another Studio site. Please choose a different custom local path.'
					),
				};
			}

			if ( ! isEmpty && ! isWordPress ) {
				return {
					path,
					name: name ?? undefined,
					isEmpty,
					isWordPress,
					error: __(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					),
				};
			}

			return {
				path,
				name: name ?? undefined,
				isEmpty,
				isWordPress,
			};
		},
		[ __, checkPathExists ]
	);

	/**
	 * Generate a proposed path for a site name and validate it
	 */
	const generateProposedPath = useCallback(
		async ( siteName: string ): Promise< PathValidationResult > => {
			const { path, isEmpty, isWordPress } = await getIpcApi().generateProposedSitePath( siteName );

			if ( await checkPathExists( path ) ) {
				return {
					path,
					isEmpty,
					isWordPress,
					error: __(
						'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
					),
				};
			}

			if ( ! isEmpty && ! isWordPress ) {
				return {
					path,
					isEmpty,
					isWordPress,
					error: __(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					),
				};
			}

			return { path, isEmpty, isWordPress };
		},
		[ __, checkPathExists ]
	);

	/**
	 * Create a new site with the given form values
	 */
	const handleCreateSite = useCallback(
		async ( formValues: CreateSiteFormValues ) => {
			try {
				let usedCustomDomain =
					formValues.useCustomDomain && formValues.customDomain
						? formValues.customDomain
						: undefined;
				if ( formValues.useCustomDomain && ! formValues.customDomain ) {
					usedCustomDomain = generateCustomDomainFromSiteName( formValues.siteName );
				}

				await createSite(
					formValues.sitePath,
					formValues.siteName,
					formValues.wpVersion,
					usedCustomDomain,
					formValues.useCustomDomain ? formValues.enableHttps : false,
					selectedBlueprint,
					formValues.phpVersion,
					async ( newSite ) => {
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
								await connectSite( { site: selectedRemoteSite, localSiteId: newSite.id } );
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
		},
		[
			__,
			clearImportState,
			createSite,
			fileForImport,
			importFile,
			startServer,
			selectedBlueprint,
			selectedRemoteSite,
			pullSite,
			connectSite,
			setSelectedTab,
		]
	);

	return useMemo(
		() => ( {
			// Site creation
			handleCreateSite,

			// Path helpers (for form to use)
			selectPath,
			generateProposedPath,

			// Default values (for form initialization)
			defaultPhpVersion: defaultPhpVersion as AllowedPHPVersion,
			defaultWpVersion: defaultWordPressVersion,

			// Blueprint deeplink values (set by deeplink handler)
			deeplinkPhpVersion,
			deeplinkWpVersion,

			// Import file
			fileForImport,
			setFileForImport,

			// Blueprint selection
			selectedBlueprint,
			setSelectedBlueprint,
			blueprintPreferredVersions,
			setBlueprintPreferredVersions,
			blueprintDeeplinkWarnings,

			// Remote site selection
			selectedRemoteSite,
			setSelectedRemoteSite,

			// Custom domain helpers
			existingDomainNames,
			loadAllCustomDomains,

			// Flow state
			isDeeplinkFlow,
			setIsDeeplinkFlow,
			isAnySiteProcessing,

			// Reset
			resetForm,
			clearDeeplinkState,
		} ),
		[
			handleCreateSite,
			selectPath,
			generateProposedPath,
			defaultPhpVersion,
			defaultWordPressVersion,
			deeplinkPhpVersion,
			deeplinkWpVersion,
			fileForImport,
			selectedBlueprint,
			blueprintPreferredVersions,
			blueprintDeeplinkWarnings,
			selectedRemoteSite,
			existingDomainNames,
			loadAllCustomDomains,
			isDeeplinkFlow,
			isAnySiteProcessing,
			resetForm,
			clearDeeplinkState,
		]
	);
}
