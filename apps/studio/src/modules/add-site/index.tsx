import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import {
	BlueprintPreferredVersions,
	BlueprintValidationWarning,
} from '@studio/common/lib/blueprint-validation';
import { SupportedPHPVersionsList } from '@studio/common/types/php-versions';
import Button from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite, CreateSiteFormValues } from 'src/hooks/use-add-site';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { AllowedPHPVersion } from 'src/lib/wordpress-server-types';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';
import { SyncSite } from 'src/modules/sync/types';
import { useRootSelector, useAppDispatch, useI18nLocale } from 'src/stores';
import { formatRtkError } from 'src/stores/format-rtk-error';
import { selectMinimumWordPressVersion } from 'src/stores/provider-constants-slice';
import { openAddSiteModal, closeAddSiteModal, selectIsAddSiteModalOpen } from 'src/stores/ui-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { useGetBlueprints, Blueprint } from 'src/stores/wpcom-api';
import BlueprintDetails from './components/blueprint-details';
import { AddSiteBlueprintSelector } from './components/blueprints';
import CreateSite from './components/create-site';
import ImportBackup from './components/import-backup';
import AddSiteOptions, { type AddSiteFlowType } from './components/options';
import { PullRemoteSite } from './components/pull-remote-site';
import Stepper from './components/stepper';
import { useFindAvailableSiteName } from './hooks/use-find-available-site-name';

type BlueprintsData = ReturnType< typeof useGetBlueprints >[ 'data' ];

interface NavigationContentProps {
	startOver: () => void;
	blueprintsData: BlueprintsData;
	isLoadingBlueprints: boolean;
	blueprintsErrorMessage?: string;
	defaultValues: {
		siteName: string;
		sitePath: string;
		phpVersion: AllowedPHPVersion;
		wpVersion: string;
	};
	onSelectPath: ( currentPath: string ) => Promise< {
		path: string;
		name?: string;
		isEmpty: boolean;
		isWordPress: boolean;
		error?: string;
	} | null >;
	onSiteNameChange: ( name: string ) => Promise< {
		path: string;
		isEmpty: boolean;
		isWordPress: boolean;
		error?: string;
	} >;
	existingDomainNames: string[];
	onFormSubmit: ( values: CreateSiteFormValues ) => void;
	onValidityChange: ( isValid: boolean ) => void;
	canSubmit: boolean;
	fileForImport: File | null;
	setFileForImport: ( file: File | null ) => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	selectedBlueprint?: Blueprint;
	blueprintPreferredVersions?: BlueprintPreferredVersions;
	setBlueprintPreferredVersions?: ( versions: BlueprintPreferredVersions | undefined ) => void;
	blueprintWarnings?: BlueprintValidationWarning[];
	setBlueprintWarnings?: ( warnings: BlueprintValidationWarning[] | undefined ) => void;
	blueprintSuggestedDomain?: string;
	setBlueprintSuggestedDomain?: ( domain: string | undefined ) => void;
	blueprintSuggestedHttps?: boolean;
	setBlueprintSuggestedHttps?: ( https: boolean | undefined ) => void;
	blueprintSuggestedSiteName?: string;
	setBlueprintSuggestedSiteName?: ( name: string | undefined ) => void;
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
	isDeeplinkFlow: boolean;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
}

function NavigationContent( props: NavigationContentProps ) {
	const { goTo, location } = useNavigator();
	const {
		startOver,
		blueprintsData,
		isLoadingBlueprints,
		blueprintsErrorMessage,
		defaultValues,
		onSelectPath,
		onSiteNameChange,
		existingDomainNames,
		onFormSubmit,
		onValidityChange,
		canSubmit,
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
		selectedRemoteSite,
		setSelectedRemoteSite,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
	} = props;

	useEffect( () => {
		if ( isDeeplinkFlow && selectedBlueprint ) {
			goTo( '/blueprint/deeplink' );
			setIsDeeplinkFlow( false );
		}
	}, [ isDeeplinkFlow, goTo, setIsDeeplinkFlow, selectedBlueprint ] );

	const handleOptionSelect = useCallback(
		( option: AddSiteFlowType ) => {
			if ( option === 'blueprint' ) {
				goTo( '/blueprint/select' );
			} else if ( option === 'create' ) {
				goTo( '/create' );
			} else if ( option === 'backup' ) {
				goTo( '/backup' );
			} else if ( option === 'pullRemote' ) {
				goTo( '/pullRemote' );
			}
		},
		[ goTo ]
	);

	const handleBlueprintContinue = useCallback( () => {
		if ( selectedBlueprint ) {
			goTo( '/blueprint/select/details' );
		}
	}, [ selectedBlueprint, goTo ] );

	const handleBlueprintDetailsContinue = useCallback( () => {
		if ( selectedBlueprint ) {
			goTo( '/blueprint/select/create' );
		}
	}, [ selectedBlueprint, goTo ] );

	const handleBackupFileSelect = useCallback(
		( file?: File ) => {
			setFileForImport( file || null );
		},
		[ setFileForImport ]
	);

	const handleBackupContinue = useCallback( () => {
		if ( fileForImport ) {
			goTo( '/backup/create' );
		}
	}, [ fileForImport, goTo ] );

	const findAvailableSiteName = useFindAvailableSiteName();
	const [ remoteSiteName, setRemoteSiteName ] = useState( '' );

	const handlePullRemoteContinue = useCallback( async () => {
		if ( selectedRemoteSite ) {
			const availableName = await findAvailableSiteName( selectedRemoteSite.name );
			setRemoteSiteName( availableName );
			goTo( '/pullRemote/create' );
		}
	}, [ findAvailableSiteName, goTo, selectedRemoteSite ] );

	const blueprints = useMemo(
		() => blueprintsData?.blueprints.slice().reverse() || [],
		[ blueprintsData ]
	);

	const handleBlueprintDeeplinkContinue = useCallback( () => {
		goTo( '/blueprint/deeplink/create' );
	}, [ goTo ] );

	const handleBack = useCallback( () => {
		const goToFirstStep = () => {
			startOver();
			goTo( '/' );
		};
		if ( location.path === '/blueprint/select/create' ) {
			goTo( '/blueprint/select/details' );
		} else if ( location.path === '/blueprint/select/details' ) {
			goTo( '/blueprint/select' );
		} else if ( location.path === '/blueprint/deeplink/create' ) {
			goTo( '/blueprint/deeplink' );
		} else if ( location.path === '/backup/create' ) {
			goTo( '/backup' );
		} else if ( location.path === '/pullRemote/create' ) {
			setRemoteSiteName( '' );
			goTo( '/pullRemote' );
		} else if (
			location.path === '/backup' ||
			location.path === '/blueprint/select' ||
			location.path === '/blueprint/deeplink' ||
			location.path === '/create' ||
			location.path === '/pullRemote'
		) {
			if ( location.path === '/backup' ) {
				setFileForImport( null );
			}
			if ( location.path === '/blueprint/select' || location.path === '/blueprint/deeplink' ) {
				setSelectedBlueprint();
				setBlueprintPreferredVersions?.( undefined );
				setBlueprintSuggestedSiteName?.( undefined );
				setBlueprintWarnings?.( undefined );
			}
			if ( location.path === '/pullRemote' ) {
				setSelectedRemoteSite( undefined );
				setRemoteSiteName( '' );
			}
			goToFirstStep();
		} else {
			goToFirstStep();
		}
	}, [
		location.path,
		goTo,
		startOver,
		setFileForImport,
		setSelectedBlueprint,
		setBlueprintPreferredVersions,
		setBlueprintWarnings,
		setSelectedRemoteSite,
		setBlueprintSuggestedSiteName,
	] );

	const applyBlueprintFormValues = useCallback(
		( blueprint?: Blueprint ) => {
			setSelectedBlueprint( blueprint );

			if ( ! blueprint?.blueprint ) {
				setBlueprintPreferredVersions?.( undefined );
				setBlueprintSuggestedDomain?.( undefined );
				setBlueprintSuggestedHttps?.( undefined );
				setBlueprintSuggestedSiteName?.( undefined );
				return;
			}

			const formValues = extractFormValuesFromBlueprint( blueprint.blueprint );

			if ( blueprint.blueprint.preferredVersions ) {
				setBlueprintPreferredVersions?.( blueprint.blueprint.preferredVersions );
			} else {
				setBlueprintPreferredVersions?.( undefined );
			}

			setBlueprintSuggestedDomain?.( formValues.customDomain );
			setBlueprintSuggestedHttps?.( formValues.enableHttps );
			setBlueprintSuggestedSiteName?.( formValues.siteName );
		},
		[
			setSelectedBlueprint,
			setBlueprintPreferredVersions,
			setBlueprintSuggestedDomain,
			setBlueprintSuggestedHttps,
			setBlueprintSuggestedSiteName,
		]
	);

	const handleBlueprintChange = useCallback(
		( blueprintId: string ) => {
			const blueprint = blueprintsData?.blueprints.find(
				( b: Blueprint ) => b.slug === blueprintId
			);
			setBlueprintWarnings?.( undefined );
			applyBlueprintFormValues( blueprint );
		},
		[ blueprintsData?.blueprints, setBlueprintWarnings, applyBlueprintFormValues ]
	);

	const handleFileBlueprintSelect = useCallback(
		( blueprint: Blueprint, warnings?: BlueprintValidationWarning[] ) => {
			applyBlueprintFormValues( blueprint );
			setBlueprintWarnings?.( warnings );
			goTo( '/blueprint/select/details' );
		},
		[ applyBlueprintFormValues, setBlueprintWarnings, goTo ]
	);

	// Build default values with blueprint preferred versions applied
	const { data: wpVersions = [] } = useGetWordPressVersions( {
		minimumVersion: MINIMUM_WORDPRESS_VERSION,
	} );
	const defaultValuesWithBlueprint = useMemo( () => {
		const values = { ...defaultValues };
		if (
			blueprintPreferredVersions?.php &&
			SupportedPHPVersionsList.includes( blueprintPreferredVersions.php )
		) {
			values.phpVersion = blueprintPreferredVersions.php as AllowedPHPVersion;
		}
		if (
			blueprintPreferredVersions?.wp &&
			wpVersions.some( ( v ) => v.value === blueprintPreferredVersions.wp )
		) {
			values.wpVersion = blueprintPreferredVersions.wp;
		}
		if ( blueprintSuggestedSiteName ) {
			values.siteName = blueprintSuggestedSiteName;
		}
		return values;
	}, [ defaultValues, blueprintPreferredVersions, blueprintSuggestedSiteName, wpVersions ] );

	const formRef = useRef< HTMLFormElement >( null );

	const createSiteProps = {
		onSelectPath,
		onSiteNameChange,
		existingDomainNames,
		onSubmit: onFormSubmit,
		onValidityChange,
		formRef,
	};

	return (
		<>
			<Navigator.Screen className="flex-1" path="/">
				<AddSiteOptions onOptionSelect={ handleOptionSelect } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/select">
				<AddSiteBlueprintSelector
					blueprints={ blueprints }
					errorMessage={ blueprintsErrorMessage }
					isLoading={ isLoadingBlueprints }
					selectedBlueprint={ selectedBlueprint?.slug || null }
					onBlueprintChange={ handleBlueprintChange }
					onFileBlueprintSelect={ handleFileBlueprintSelect }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/select/details">
				<BlueprintDetails
					selectedBlueprint={ selectedBlueprint }
					warnings={ blueprintWarnings }
					source={ selectedBlueprint?.slug?.startsWith( 'file:' ) ? 'file' : 'featured' }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/select/create">
				<CreateSite
					{ ...createSiteProps }
					defaultValues={ defaultValuesWithBlueprint }
					blueprintPreferredVersions={ blueprintPreferredVersions }
					blueprintSuggestedDomain={ blueprintSuggestedDomain }
					blueprintSuggestedHttps={ blueprintSuggestedHttps }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite { ...createSiteProps } defaultValues={ defaultValues } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink">
				<BlueprintDetails
					selectedBlueprint={ selectedBlueprint }
					warnings={ blueprintWarnings }
					source="deeplink"
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink/create">
				<CreateSite
					{ ...createSiteProps }
					defaultValues={ defaultValuesWithBlueprint }
					blueprintPreferredVersions={ blueprintPreferredVersions }
					blueprintSuggestedDomain={ blueprintSuggestedDomain }
					blueprintSuggestedHttps={ blueprintSuggestedHttps }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup">
				<ImportBackup onFileSelect={ handleBackupFileSelect } selectedFile={ fileForImport } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup/create">
				<CreateSite { ...createSiteProps } defaultValues={ defaultValues } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1 flex justify-center" path="/pullRemote">
				<PullRemoteSite
					selectedRemoteSite={ selectedRemoteSite }
					setSelectedRemoteSite={ setSelectedRemoteSite }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/pullRemote/create">
				<CreateSite
					{ ...createSiteProps }
					defaultValues={ { ...defaultValues, siteName: remoteSiteName } }
				/>
			</Navigator.Screen>
			<Stepper
				currentPath={ location.path }
				onBack={ handleBack }
				onBlueprintContinue={ handleBlueprintContinue }
				onBlueprintDetailsContinue={ handleBlueprintDetailsContinue }
				onBlueprintDeeplinkContinue={ handleBlueprintDeeplinkContinue }
				onBackupContinue={ handleBackupContinue }
				onPullRemoteContinue={ handlePullRemoteContinue }
				onCreateSubmit={ () => {
					formRef.current?.requestSubmit();
				} }
				canSubmitBlueprint={ !! selectedBlueprint }
				canSubmitBlueprintDetails={ !! selectedBlueprint }
				canSubmitBlueprintDeeplink={ !! selectedBlueprint }
				canSubmitBackup={ !! fileForImport }
				canSubmitPullRemote={ !! selectedRemoteSite }
				canSubmitCreate={ canSubmit }
			/>
		</>
	);
}

export interface AddSiteModalContentProps {
	isOpen?: boolean;
	onSubmit?: () => void;
	className?: string;
	addSiteProps: ReturnType< typeof useAddSite >;
}

export function AddSiteModalContent( {
	isOpen = true,
	onSubmit,
	className,
	addSiteProps,
}: AddSiteModalContentProps ) {
	const { __ } = useI18n();
	const [ formInitialized, setFormInitialized ] = useState( false );
	const [ defaultSiteName, setDefaultSiteName ] = useState( '' );
	const [ defaultSitePath, setDefaultSitePath ] = useState( '' );
	const [ isFormValid, setIsFormValid ] = useState( true );
	const locale = useI18nLocale();

	const {
		data: blueprintsData,
		isLoading: isLoadingBlueprints,
		error: blueprintsError,
	} = useGetBlueprints( { locale } );

	const { sites, loadingSites } = useSiteDetails();
	const minimumWordPressVersion = useRootSelector( selectMinimumWordPressVersion );

	const {
		handleCreateSite,
		selectPath,
		generateProposedPath,
		defaultPhpVersion,
		defaultWpVersion,
		deeplinkPhpVersion,
		deeplinkWpVersion,
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
		selectedRemoteSite,
		setSelectedRemoteSite,
		existingDomainNames,
		loadAllCustomDomains,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
	} = addSiteProps;

	const { data: versions = [] } = useGetWordPressVersions( {
		minimumVersion: minimumWordPressVersion,
	} );
	const latestStableVersion = versions.find( ( version ) => version.value === 'latest' );

	const initialNavigatorPath = selectedBlueprint ? '/blueprint/deeplink' : '/';

	// Initialize form with generated site name and path
	useEffect( () => {
		const initializeForm = async () => {
			if ( ! isOpen || formInitialized || loadingSites ) return;

			const generatedSiteName = await generateSiteName( sites );
			const { path } = await getIpcApi().generateProposedSitePath( generatedSiteName );

			setDefaultSiteName( generatedSiteName );
			setDefaultSitePath( path );
			setFormInitialized( true );
			loadAllCustomDomains();
		};

		void initializeForm();
	}, [ isOpen, formInitialized, loadingSites, sites, loadAllCustomDomains ] );

	// Update site name and path when blueprint suggests a site name
	const findAvailableSiteName = useFindAvailableSiteName();
	useEffect( () => {
		if ( ! formInitialized || ! blueprintSuggestedSiteName ) {
			return;
		}

		const updatePathForBlueprintName = async () => {
			const availableName = await findAvailableSiteName( blueprintSuggestedSiteName );
			const { path } = await getIpcApi().generateProposedSitePath( availableName );
			setDefaultSiteName( availableName );
			setDefaultSitePath( path );
		};
		void updatePathForBlueprintName();
	}, [ blueprintSuggestedSiteName, formInitialized, findAvailableSiteName ] );

	// Reset form initialized state when modal closes
	useEffect( () => {
		if ( ! isOpen ) {
			setFormInitialized( false );
		}
	}, [ isOpen ] );
	const startOver = useCallback( () => {
		setFormInitialized( false );
	}, [] );

	const defaultValues = useMemo(
		() => ( {
			siteName: defaultSiteName,
			sitePath: defaultSitePath,
			phpVersion: isDeeplinkFlow ? deeplinkPhpVersion : defaultPhpVersion,
			wpVersion: isDeeplinkFlow
				? deeplinkWpVersion
				: latestStableVersion?.value ?? defaultWpVersion,
		} ),
		[
			defaultSiteName,
			defaultSitePath,
			defaultPhpVersion,
			defaultWpVersion,
			deeplinkPhpVersion,
			deeplinkWpVersion,
			isDeeplinkFlow,
			latestStableVersion,
		]
	);

	const handleFormSubmit = useCallback(
		async ( values: CreateSiteFormValues ) => {
			const siteAddedMessage = sprintf(
				// translators: %s is the site name.
				__( '%s site added.' ),
				values.siteName
			);

			onSubmit?.();
			await handleCreateSite( values );
			speak( siteAddedMessage );
		},
		[ __, handleCreateSite, onSubmit ]
	);

	// canSubmit is true if the form is initialized, has a name, and is valid (no errors)
	const canSubmit = formInitialized && defaultSiteName.trim().length > 0 && isFormValid;

	return (
		<Navigator
			className={ className ?? 'w-full h-full app-no-drag-region' }
			initialPath={ initialNavigatorPath }
		>
			<NavigationContent
				blueprintsData={ blueprintsData }
				blueprintsErrorMessage={ formatRtkError( blueprintsError ) }
				isLoadingBlueprints={ isLoadingBlueprints }
				defaultValues={ defaultValues }
				onSelectPath={ selectPath }
				onSiteNameChange={ generateProposedPath }
				existingDomainNames={ existingDomainNames }
				onFormSubmit={ handleFormSubmit }
				onValidityChange={ setIsFormValid }
				canSubmit={ canSubmit }
				fileForImport={ fileForImport }
				setFileForImport={ setFileForImport }
				selectedBlueprint={ selectedBlueprint }
				setSelectedBlueprint={ setSelectedBlueprint }
				blueprintPreferredVersions={ blueprintPreferredVersions }
				setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
				blueprintWarnings={ blueprintWarnings }
				setBlueprintWarnings={ setBlueprintWarnings }
				blueprintSuggestedDomain={ blueprintSuggestedDomain }
				setBlueprintSuggestedDomain={ setBlueprintSuggestedDomain }
				blueprintSuggestedHttps={ blueprintSuggestedHttps }
				setBlueprintSuggestedHttps={ setBlueprintSuggestedHttps }
				blueprintSuggestedSiteName={ blueprintSuggestedSiteName }
				setBlueprintSuggestedSiteName={ setBlueprintSuggestedSiteName }
				selectedRemoteSite={ selectedRemoteSite }
				setSelectedRemoteSite={ setSelectedRemoteSite }
				isDeeplinkFlow={ isDeeplinkFlow }
				setIsDeeplinkFlow={ setIsDeeplinkFlow }
				startOver={ startOver }
			/>
		</Navigator>
	);
}

interface AddSiteModalProps {
	className?: string;
}

export default function AddSiteModal( { className }: AddSiteModalProps ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const showModal = useRootSelector( selectIsAddSiteModalOpen );

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding: false, isAddSiteVisible: showModal } );
	}, [ showModal ] );

	const openModal = useCallback( () => {
		dispatch( openAddSiteModal() );
	}, [ dispatch ] );

	const addSiteProps = useAddSite();
	const {
		resetForm,
		isAnySiteProcessing,
		setSelectedBlueprint,
		setDeeplinkPhpVersion,
		setDeeplinkWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintWarnings,
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setIsDeeplinkFlow,
	} = addSiteProps;

	const closeModal = useCallback( () => {
		resetForm();
		dispatch( closeAddSiteModal() );
	}, [ resetForm, dispatch ] );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		setSelectedBlueprint,
		setPhpVersion: setDeeplinkPhpVersion,
		setWpVersion: setDeeplinkWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintWarnings,
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setIsDeeplinkFlow,
		onModalOpen: openModal,
	} );

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				<AddSiteModalContent
					isOpen={ showModal }
					onSubmit={ closeModal }
					addSiteProps={ addSiteProps }
				/>
			</FullscreenModal>
			<Button
				variant="outlined"
				className={ className }
				onClick={ openModal }
				disabled={ isAnySiteProcessing }
				data-testid="add-site-button"
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
