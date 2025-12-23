import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import Button from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SyncSite } from 'src/modules/sync/types';
import { useRootSelector } from 'src/stores';
import { formatRtkError } from 'src/stores/format-rtk-error';
import { selectMinimumWordPressVersion } from 'src/stores/provider-constants-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { useGetBlueprints, Blueprint } from 'src/stores/wpcom-api';
import BlueprintDeeplink from './components/blueprint-deeplink';
import { AddSiteBlueprintSelector } from './components/blueprints';
import CreateSite from './components/create-site';
import ImportBackup from './components/import-backup';
import AddSiteOptions, { type AddSiteFlowType } from './components/options';
import { PullRemoteSite } from './components/pull-remote-site';
import Stepper from './components/stepper';
import { useFindAvailableSiteName } from './hooks/use-find-available-site-name';
import type { CreateSiteFormValues } from './components/create-site-form';

type BlueprintsData = ReturnType< typeof useGetBlueprints >[ 'data' ];

interface NavigationContentProps {
	blueprintsData: BlueprintsData;
	isLoadingBlueprints: boolean;
	blueprintsErrorMessage?: string | undefined;
	siteName: string | null;
	sitePath: string;
	phpVersion: string;
	wpVersion: string;
	handlePathSelectorClick: () => void;
	error: string;
	doesPathContainWordPress: boolean;
	existingDomainNames: string[];
	fileForImport: File | null;
	setFileForImport: ( file: File | null ) => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	selectedBlueprint?: Blueprint;
	blueprintPreferredVersions?: { php?: string; wp?: string };
	setBlueprintPreferredVersions?: ( versions: { php?: string; wp?: string } | undefined ) => void;
	blueprintDeeplinkWarnings?: BlueprintValidationWarning[];
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
	isDeeplinkFlow: boolean;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
	setPhpVersion: ( version: string ) => void;
	setWpVersion: ( version: string ) => void;
	handleSiteNameChange: ( name: string ) => Promise< void >;
	handleFormSubmit: ( values: CreateSiteFormValues ) => void;
}

function NavigationContent( props: NavigationContentProps ) {
	const { __ } = useI18n();
	const { goTo, location } = useNavigator();
	const {
		blueprintsData,
		isLoadingBlueprints,
		blueprintsErrorMessage,
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintDeeplinkWarnings,
		selectedRemoteSite,
		setSelectedRemoteSite,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
		siteName,
		sitePath,
		phpVersion,
		wpVersion,
		handlePathSelectorClick,
		error,
		doesPathContainWordPress,
		existingDomainNames,
		fileForImport,
		setFileForImport,
		selectedBlueprint,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		handleSiteNameChange,
		handleFormSubmit,
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
	const handlePullRemoteContinue = useCallback( async () => {
		if ( selectedRemoteSite ) {
			const availableName = await findAvailableSiteName( selectedRemoteSite.name );
			await handleSiteNameChange( availableName );
			goTo( '/pullRemote/create' );
		}
	}, [ handleSiteNameChange, findAvailableSiteName, goTo, selectedRemoteSite ] );

	const blueprints = useMemo(
		() => blueprintsData?.blueprints.slice().reverse() || [],
		[ blueprintsData ]
	);

	const isOnCreatePath =
		location.path === '/create' ||
		location.path === '/blueprint/select/create' ||
		location.path === '/blueprint/deeplink/create' ||
		location.path === '/backup/create' ||
		location.path === '/pullRemote/create';
	const canSubmit = isOnCreatePath && siteName?.trim() && ! error;

	const handleBlueprintDeeplinkContinue = useCallback( () => {
		goTo( '/blueprint/deeplink/create' );
	}, [ goTo ] );

	const handleBack = useCallback( () => {
		if ( location.path === '/blueprint/select/create' ) {
			goTo( '/blueprint/select' );
		} else if ( location.path === '/blueprint/deeplink/create' ) {
			goTo( '/blueprint/deeplink' );
		} else if ( location.path === '/backup/create' ) {
			goTo( '/backup' );
		} else if ( location.path === '/pullRemote/create' ) {
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
			}
			if ( location.path === '/pullRemote' ) {
				setSelectedRemoteSite( undefined );
			}
			goTo( '/' );
		} else {
			goTo( '/' );
		}
	}, [
		location.path,
		goTo,
		setFileForImport,
		setSelectedBlueprint,
		setBlueprintPreferredVersions,
		setSelectedRemoteSite,
	] );

	const applyBlueprintVersions = useCallback(
		( blueprint?: Blueprint ) => {
			if ( blueprint?.blueprint?.preferredVersions ) {
				const preferredVersions = blueprint.blueprint.preferredVersions as {
					php?: string;
					wp?: string;
				};
				setBlueprintPreferredVersions?.( preferredVersions );

				// Apply the preferred versions to the form
				if ( preferredVersions.php && preferredVersions.php !== 'latest' ) {
					setPhpVersion( preferredVersions.php );
				}
				if ( preferredVersions.wp && preferredVersions.wp !== 'latest' ) {
					setWpVersion( preferredVersions.wp );
				}
			} else {
				setBlueprintPreferredVersions?.( undefined );
			}
		},
		[ setBlueprintPreferredVersions, setPhpVersion, setWpVersion ]
	);

	const handleBlueprintChange = useCallback(
		( blueprintId: string ) => {
			const blueprint = blueprintsData?.blueprints.find(
				( b: Blueprint ) => b.slug === blueprintId
			);
			setSelectedBlueprint( blueprint );
			applyBlueprintVersions( blueprint );
		},
		[ blueprintsData?.blueprints, setSelectedBlueprint, applyBlueprintVersions ]
	);

	const handleFileBlueprintSelect = useCallback(
		( blueprint: Blueprint ) => {
			setSelectedBlueprint( blueprint );
			applyBlueprintVersions( blueprint );
		},
		[ setSelectedBlueprint, applyBlueprintVersions ]
	);

	// Common props for CreateSite component
	const createSiteCommonProps = {
		siteName,
		sitePath,
		phpVersion,
		wpVersion,
		handlePathSelectorClick,
		error,
		doesPathContainWordPress,
		existingDomainNames,
		onSubmit: handleFormSubmit,
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
			<Navigator.Screen className="flex-1" path="/blueprint/select/create">
				<CreateSite
					{ ...createSiteCommonProps }
					blueprintPreferredVersions={ blueprintPreferredVersions }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite { ...createSiteCommonProps } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink">
				<BlueprintDeeplink
					selectedBlueprint={ selectedBlueprint }
					warnings={ blueprintDeeplinkWarnings }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink/create">
				<CreateSite
					{ ...createSiteCommonProps }
					blueprintPreferredVersions={ blueprintPreferredVersions }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup">
				<ImportBackup onFileSelect={ handleBackupFileSelect } selectedFile={ fileForImport } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup/create">
				<CreateSite { ...createSiteCommonProps } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1 flex justify-center" path="/pullRemote">
				<PullRemoteSite
					selectedRemoteSite={ selectedRemoteSite }
					setSelectedRemoteSite={ async ( remoteSite?: SyncSite ) => {
						setSelectedRemoteSite( remoteSite );
					} }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/pullRemote/create">
				<CreateSite { ...createSiteCommonProps } />
			</Navigator.Screen>
			<Stepper
				currentPath={ location.path }
				onBack={ handleBack }
				onBlueprintContinue={ handleBlueprintContinue }
				onBlueprintDeeplinkContinue={ handleBlueprintDeeplinkContinue }
				onBackupContinue={ handleBackupContinue }
				onPullRemoteContinue={ handlePullRemoteContinue }
				onCreateSubmit={ () =>
					handleFormSubmit( {
						siteName: siteName || '',
						sitePath,
						phpVersion:
							phpVersion as import('src/lib/wordpress-provider/constants').AllowedPHPVersion,
						wpVersion,
						useCustomDomain: false,
						customDomain: null,
						enableHttps: false,
					} )
				}
				canSubmitBlueprint={ !! selectedBlueprint }
				canSubmitBlueprintDeeplink={ !! selectedBlueprint }
				canSubmitBackup={ !! fileForImport }
				canSubmitPullRemote={ !! selectedRemoteSite }
				canSubmitCreate={ !! canSubmit }
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
	const [ nameSuggested, setNameSuggested ] = useState( false );

	const {
		data: blueprintsData,
		isLoading: isLoadingBlueprints,
		error: blueprintsError,
	} = useGetBlueprints();

	const { sites, loadingSites } = useSiteDetails();

	const {
		handleAddSiteClick,
		siteName,
		setSiteName,
		setWpVersion,
		setProposedSitePath,
		setDoesPathContainWordPress,
		loadAllCustomDomains,
		selectedBlueprint,
		setSelectedBlueprint,
		selectedRemoteSite,
		setSelectedRemoteSite,
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintDeeplinkWarnings,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
		sitePath,
		phpVersion,
		setPhpVersion,
		wpVersion,
		handlePathSelectorClick,
		error,
		doesPathContainWordPress,
		fileForImport,
		setFileForImport,
		handleSiteNameChange,
		existingDomainNames,
		setUseCustomDomain,
		setCustomDomain,
		setEnableHttps,
	} = addSiteProps;

	const minimumWordPressVersion = useRootSelector( selectMinimumWordPressVersion );
	const { data: versions = [] } = useGetWordPressVersions( {
		minimumVersion: minimumWordPressVersion,
	} );
	const latestStableVersion = versions.find( ( version ) => version.value === 'latest' );

	const initialNavigatorPath = selectedBlueprint ? '/blueprint/deeplink' : '/';

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName || ''
	);

	const initializeForm = useCallback( async () => {
		const generatedSiteName = await generateSiteName( sites );
		const { path, name, isWordPress } =
			await getIpcApi().generateProposedSitePath( generatedSiteName );
		if ( latestStableVersion ) {
			setWpVersion( latestStableVersion.value );
		}
		setNameSuggested( true );
		setSiteName( name );
		setProposedSitePath( path );
		setDoesPathContainWordPress( isWordPress );
		loadAllCustomDomains();
	}, [
		sites,
		setSiteName,
		setProposedSitePath,
		setDoesPathContainWordPress,
		setWpVersion,
		latestStableVersion,
		loadAllCustomDomains,
	] );

	useEffect( () => {
		if ( isOpen && ! nameSuggested && ! loadingSites ) {
			void initializeForm();
		}
	}, [ isOpen, nameSuggested, loadingSites, initializeForm ] );

	const handleFormSubmit = useCallback(
		async ( values: CreateSiteFormValues ) => {
			// Sync form values back to hook state before submitting
			if ( values.siteName !== siteName ) {
				await handleSiteNameChange( values.siteName );
			}
			setPhpVersion( values.phpVersion );
			setWpVersion( values.wpVersion );
			setUseCustomDomain( values.useCustomDomain );
			setCustomDomain( values.customDomain );
			setEnableHttps( values.enableHttps );

			onSubmit?.();
			await handleAddSiteClick();
			speak( siteAddedMessage );
			setNameSuggested( false );
		},
		[
			handleAddSiteClick,
			siteAddedMessage,
			onSubmit,
			siteName,
			handleSiteNameChange,
			setPhpVersion,
			setWpVersion,
			setUseCustomDomain,
			setCustomDomain,
			setEnableHttps,
		]
	);

	return (
		<Navigator
			className={ className ?? 'w-full h-full app-no-drag-region' }
			initialPath={ initialNavigatorPath }
		>
			<NavigationContent
				siteName={ siteName }
				sitePath={ sitePath }
				phpVersion={ phpVersion }
				wpVersion={ wpVersion }
				handlePathSelectorClick={ handlePathSelectorClick }
				error={ error }
				doesPathContainWordPress={ doesPathContainWordPress }
				existingDomainNames={ existingDomainNames }
				fileForImport={ fileForImport }
				setFileForImport={ setFileForImport }
				selectedBlueprint={ selectedBlueprint }
				setSelectedBlueprint={ setSelectedBlueprint }
				blueprintsData={ blueprintsData }
				blueprintsErrorMessage={ formatRtkError( blueprintsError ) }
				isLoadingBlueprints={ isLoadingBlueprints }
				handleFormSubmit={ handleFormSubmit }
				blueprintPreferredVersions={ blueprintPreferredVersions }
				setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
				blueprintDeeplinkWarnings={ blueprintDeeplinkWarnings }
				selectedRemoteSite={ selectedRemoteSite }
				setSelectedRemoteSite={ setSelectedRemoteSite }
				isDeeplinkFlow={ isDeeplinkFlow }
				setIsDeeplinkFlow={ setIsDeeplinkFlow }
				setPhpVersion={ setPhpVersion }
				setWpVersion={ setWpVersion }
				handleSiteNameChange={ handleSiteNameChange }
			/>
		</Navigator>
	);
}

interface AddSiteModalProps {
	className?: string;
}

export default function AddSiteModal( { className }: AddSiteModalProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding: false, isAddSiteVisible: showModal } );
	}, [ showModal ] );

	const openModal = useCallback( () => {
		setShowModal( true );
	}, [] );

	const addSiteProps = useAddSite( { openModal } );
	const { resetForm, isAnySiteProcessing } = addSiteProps;

	const closeModal = useCallback( () => {
		resetForm();
		setShowModal( false );
	}, [ resetForm ] );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
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
