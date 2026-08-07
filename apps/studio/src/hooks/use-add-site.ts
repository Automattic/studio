import * as Sentry from '@sentry/electron/renderer';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { updateBlueprintWithFormValues } from '@studio/common/lib/blueprint-settings';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { type SiteFileAccess } from '@studio/common/lib/site-file-access';
import {
	validateProposedSitePath,
	validateSelectedSitePath,
	type PathValidationResult,
} from '@studio/common/lib/site-path-validation';
import { type SiteRuntime } from '@studio/common/lib/site-runtime';
import { SupportedPHPVersion } from '@studio/common/types/php-versions';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import { Blueprint } from 'src/stores/wpcom-api';
import type { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import type { SyncSite } from '@studio/common/types/sync';
import type { SyncOption } from 'src/types';

/**
 * Form values passed when creating a site
 */
export interface CreateSiteFormValues {
	siteName: string;
	sitePath: string;
	phpVersion: SupportedPHPVersion;
	wpVersion: string;
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
	useCustomDomain: boolean;
	customDomain: string | null;
	enableHttps: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
}

export type { PathValidationResult } from '@studio/common/lib/site-path-validation';

export function useAddSite() {
	const { __ } = useI18n();
	const { createSite, sites } = useSiteDetails();
	const { importFile, clearImportState, importState } = useImportExport();
	const [ connectSite ] = useConnectSiteMutation();
	const { client } = useAuth();
	const dispatch = useAppDispatch();
	const { setSelectedTab } = useContentTabs();
	const [ fileForImport, setFileForImport ] = useState< File | null >( null );
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< Blueprint | undefined >();
	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | undefined >();
	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		BlueprintPreferredVersions | undefined
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
		setBlueprintSuggestedDomain( undefined );
		setBlueprintSuggestedHttps( undefined );
		setBlueprintSuggestedSiteName( undefined );
		setBlueprintRequiresCustomDomain( false );
	}, [] );

	// For blueprint deeplinks - we need temporary state for PHP/WP versions
	const [ deeplinkPhpVersion, setDeeplinkPhpVersion ] =
		useState< SupportedPHPVersion >( DEFAULT_PHP_VERSION );
	const [ deeplinkWpVersion, setDeeplinkWpVersion ] =
		useState< string >( DEFAULT_WORDPRESS_VERSION );

	const resetForm = useCallback( () => {
		setFileForImport( null );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintSuggestedDomain( undefined );
		setBlueprintSuggestedHttps( undefined );
		setBlueprintSuggestedSiteName( undefined );
		setBlueprintRequiresCustomDomain( false );
		setSelectedRemoteSite( undefined );
		setDeeplinkPhpVersion( DEFAULT_PHP_VERSION );
		setDeeplinkWpVersion( DEFAULT_WORDPRESS_VERSION );
		clearDeeplinkState();
	}, [ clearDeeplinkState ] );

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

			return validateSelectedSitePath( response, await checkPathExists( response.path ) );
		},
		[ __, checkPathExists ]
	);

	/**
	 * Generate a proposed path for a site name and validate it
	 */
	const generateProposedPath = useCallback(
		async ( siteName: string ): Promise< PathValidationResult > => {
			const result = await getIpcApi().generateProposedSitePath( siteName );
			return validateProposedSitePath( result, await checkPathExists( result.path ) );
		},
		[ checkPathExists ]
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
				// For import/sync workflows, the respective handlers will start the server.
				// Exception: a WordPress export (.xml / WXR) is merged into an existing
				// install via the wordpress-importer plugin, so WordPress must already be
				// installed and configured before the import runs. Start the server during
				// creation in that case so `wp-config.php` and the database exist first.
				const isWxrImport = !! fileForImport && fileForImport.name.toLowerCase().endsWith( '.xml' );
				const shouldSkipStart = ( !! fileForImport && ! isWxrImport ) || !! selectedRemoteSite;

				const enableHttps = formValues.useCustomDomain ? formValues.enableHttps : false;
				// Blueprint is inferred by the CLI from the blueprint arg; only tag the paths it can't
				// see. A pull from a remote WordPress.com site rides the same create-then-populate path.
				const flowType = fileForImport ? 'import' : selectedRemoteSite ? 'sync' : undefined;
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
						} else if ( selectedRemoteSite && client ) {
							await connectSite( { site: selectedRemoteSite, localSiteId: newSite.id } );
							const pullOptions: SyncOption[] = [ 'all' ];
							void dispatch(
								syncOperationsThunks.pullSite( {
									client,
									connectedSite: selectedRemoteSite,
									selectedSite: newSite,
									options: { optionsToSync: pullOptions },
								} )
							);
							setSelectedTab( 'sync' );
						} else {
							getIpcApi().showNotification( {
								title: newSite.name,
								body: __( 'Your new site was created' ),
							} );
						}
					},
					shouldSkipStart,
					formValues.adminUsername,
					formValues.adminPassword,
					formValues.adminEmail,
					formValues.runtime,
					formValues.fileAccess,
					flowType
				);
			} catch ( e ) {
				Sentry.captureException( e );
			}
		},
		[
			__,
			clearImportState,
			client,
			createSite,
			dispatch,
			fileForImport,
			importFile,
			selectedBlueprint,
			selectedRemoteSite,
			connectSite,
			setSelectedTab,
		]
	);

	return useMemo(
		() => ( {
			handleCreateSite,
			selectPath,
			generateProposedPath,
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
			deeplinkPhpVersion,
			deeplinkWpVersion,
			setDeeplinkPhpVersion,
			setDeeplinkWpVersion,
			fileForImport,
			selectedBlueprint,
			blueprintPreferredVersions,
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
