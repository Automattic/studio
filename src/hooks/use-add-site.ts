import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { updateBlueprintWithFormValues } from 'common/lib/blueprint-settings';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { generateCustomDomainFromSiteName } from 'common/lib/domains';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import {
	selectDefaultPhpVersion,
	selectDefaultWordPressVersion,
} from 'src/stores/provider-constants-slice';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import { Blueprint } from 'src/stores/wpcom-api';
import type { BlueprintPreferredVersions } from 'common/lib/blueprint-validation';
import type { AllowedPHPVersion } from 'src/lib/wordpress-server-types';
import type { SyncSite } from 'src/modules/sync/types';
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

export function useAddSite() {
	const { __ } = useI18n();
	const { createSite, sites } = useSiteDetails();
	const { importFile, clearImportState, importState } = useImportExport();
	const [ connectSite ] = useConnectSiteMutation();
	const { pullSite } = useSyncSites();
	const { setSelectedTab } = useContentTabs();
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );

	const [ fileForImport, setFileForImport ] = useState< File | null >( null );
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< Blueprint | undefined >();
	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | undefined >();
	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		BlueprintPreferredVersions | undefined
	>();
	const [ blueprintWarnings, setBlueprintWarnings ] = useState<
		BlueprintValidationWarning[] | undefined
	>();
	const [ blueprintSuggestedDomain, setBlueprintSuggestedDomain ] = useState<
		string | undefined
	>();
	const [ blueprintSuggestedHttps, setBlueprintSuggestedHttps ] = useState< boolean | undefined >();
	const [ blueprintSuggestedSiteName, setBlueprintSuggestedSiteName ] = useState<
		string | undefined
	>();
	const [ blueprintRequiresCustomDomain, setBlueprintRequiresCustomDomain ] = useState( false );
	const [ isDeeplinkFlow, setIsDeeplinkFlow ] = useState( false );
	const [ existingDomainNames, setExistingDomainNames ] = useState< string[] >( [] );

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const clearDeeplinkState = useCallback( () => {
		setIsDeeplinkFlow( false );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintWarnings( undefined );
		setBlueprintSuggestedDomain( undefined );
		setBlueprintSuggestedHttps( undefined );
		setBlueprintSuggestedSiteName( undefined );
		setBlueprintRequiresCustomDomain( false );
	}, [] );

	// For blueprint deeplinks - we need temporary state for PHP/WP versions
	const [ deeplinkPhpVersion, setDeeplinkPhpVersion ] = useState< AllowedPHPVersion >(
		defaultPhpVersion as AllowedPHPVersion
	);
	const [ deeplinkWpVersion, setDeeplinkWpVersion ] = useState( defaultWordPressVersion );

	const resetForm = useCallback( () => {
		setFileForImport( null );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintWarnings( undefined );
		setBlueprintSuggestedDomain( undefined );
		setBlueprintSuggestedHttps( undefined );
		setBlueprintSuggestedSiteName( undefined );
		setBlueprintRequiresCustomDomain( false );
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
			const { path, isEmpty, isWordPress, isNameTooLong } =
				await getIpcApi().generateProposedSitePath( siteName );

			if ( isNameTooLong ) {
				return {
					path,
					isEmpty,
					isWordPress,
					error: __( 'The site name is too long. Please choose a shorter site name.' ),
				};
			}

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
				// For import/sync workflows, the respective handlers will start the server
				const shouldSkipStart = !! fileForImport || !! selectedRemoteSite;

				const enableHttps = formValues.useCustomDomain ? formValues.enableHttps : false;
				let updatedBlueprint: Blueprint | undefined;
				if ( selectedBlueprint?.blueprint ) {
					const updatedJson = updateBlueprintWithFormValues( selectedBlueprint.blueprint, {
						phpVersion: formValues.phpVersion,
						wpVersion: formValues.wpVersion,
						customDomain: usedCustomDomain,
						enableHttps,
						siteName: formValues.siteName,
					} );
					updatedBlueprint = { ...selectedBlueprint, blueprint: updatedJson };
				}

				await createSite(
					formValues.sitePath,
					formValues.siteName,
					formValues.wpVersion,
					usedCustomDomain,
					enableHttps,
					updatedBlueprint ?? selectedBlueprint,
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
						} else if ( selectedRemoteSite ) {
							await connectSite( { site: selectedRemoteSite, localSiteId: newSite.id } );
							const pullOptions: SyncOption[] = [ 'all' ];
							pullSite( selectedRemoteSite, newSite, {
								optionsToSync: pullOptions,
							} );
							setSelectedTab( 'sync' );
						} else {
							getIpcApi().showNotification( {
								title: newSite.name,
								body: __( 'Your new site was created' ),
							} );
						}
					},
					shouldSkipStart
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
			selectedBlueprint,
			selectedRemoteSite,
			pullSite,
			connectSite,
			setSelectedTab,
		]
	);

	return useMemo(
		() => ( {
			handleCreateSite,
			selectPath,
			generateProposedPath,
			defaultPhpVersion: defaultPhpVersion as AllowedPHPVersion,
			defaultWpVersion: defaultWordPressVersion,
			deeplinkPhpVersion,
			deeplinkWpVersion,
			setDeeplinkPhpVersion,
			setDeeplinkWpVersion,
			fileForImport,
			setFileForImport,
			selectedBlueprint,
			setSelectedBlueprint,
			blueprintPreferredVersions,
			setBlueprintPreferredVersions,
			blueprintWarnings,
			setBlueprintWarnings,
			blueprintSuggestedDomain,
			setBlueprintSuggestedDomain,
			blueprintSuggestedHttps,
			setBlueprintSuggestedHttps,
			blueprintSuggestedSiteName,
			setBlueprintSuggestedSiteName,
			blueprintRequiresCustomDomain,
			setBlueprintRequiresCustomDomain,
			selectedRemoteSite,
			setSelectedRemoteSite,
			existingDomainNames,
			loadAllCustomDomains,
			isDeeplinkFlow,
			setIsDeeplinkFlow,
			isAnySiteProcessing,
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
			setDeeplinkPhpVersion,
			setDeeplinkWpVersion,
			fileForImport,
			selectedBlueprint,
			blueprintPreferredVersions,
			blueprintWarnings,
			blueprintSuggestedDomain,
			blueprintSuggestedHttps,
			blueprintSuggestedSiteName,
			blueprintRequiresCustomDomain,
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
