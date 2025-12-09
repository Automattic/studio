import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import Button from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SyncSite } from 'src/modules/sync/types';
import { useRootSelector } from 'src/stores';
import { formatRtkError } from 'src/stores/format-rtk-error';
import {
	selectDefaultPhpVersion,
	selectDefaultWordPressVersion,
	selectMinimumWordPressVersion,
} from 'src/stores/provider-constants-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { useGetBlueprints, Blueprint } from 'src/stores/wpcom-api';
import BlueprintDeeplink from './components/blueprint-deeplink';
import { AddSiteBlueprintSelector } from './components/blueprints';
import CreateSite from './components/create-site';
import ImportBackup from './components/import-backup';
import AddSiteOptions, { type AddSiteFlowType } from './components/options';
import { PullRemoteSite } from './components/pull-remote-site';
import Stepper from './components/stepper';
import { useBlueprintDeeplink } from './hooks/use-blueprint-deeplink';

type BlueprintsData = ReturnType< typeof useGetBlueprints >[ 'data' ];

interface NavigationContentProps {
	blueprintsData: BlueprintsData;
	isLoadingBlueprints: boolean;
	siteName: string | null;
	handleSiteNameChange: ( name: string ) => Promise< void >;
	phpVersion: string;
	setPhpVersion: ( version: string ) => void;
	wpVersion: string;
	setWpVersion: ( version: string ) => void;
	sitePath: string;
	handlePathSelectorClick: () => void;
	error: string;
	handleSubmit: ( event: FormEvent ) => void;
	doesPathContainWordPress: boolean;
	useCustomDomain: boolean;
	setUseCustomDomain: ( use: boolean ) => void;
	customDomain: string | null;
	setCustomDomain: ( domain: string | null ) => void;
	customDomainError: string;
	enableHttps: boolean;
	setEnableHttps: ( enable: boolean ) => void;
	fileForImport: File | null;
	setFileForImport: ( file: File | null ) => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	selectedBlueprint?: Blueprint;
	blueprintsErrorMessage?: string | undefined;
	blueprintPreferredVersions?: { php?: string; wp?: string };
	setBlueprintPreferredVersions?: ( versions: { php?: string; wp?: string } | undefined ) => void;
	blueprintDeeplinkWarnings?: BlueprintValidationWarning[];
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
	isDeeplinkFlow: boolean;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
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
		...createSiteProps
	} = props;

	const { selectedBlueprint, setSelectedBlueprint, setPhpVersion, setWpVersion } = createSiteProps;

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
			createSiteProps.setFileForImport( file || null );
		},
		[ createSiteProps ]
	);

	const handleBackupContinue = useCallback( () => {
		if ( createSiteProps.fileForImport ) {
			goTo( '/backup/create' );
		}
	}, [ createSiteProps, goTo ] );

	const handlePullRemoteContinue = useCallback( () => {
		if ( selectedRemoteSite ) {
			goTo( '/pullRemote/create' );
		}
	}, [ selectedRemoteSite, goTo ] );

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
	const canSubmit =
		isOnCreatePath &&
		createSiteProps.siteName?.trim() &&
		! createSiteProps.error &&
		( ! createSiteProps.useCustomDomain || ! createSiteProps.customDomainError );

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
				createSiteProps.setFileForImport( null );
			}
			if ( location.path === '/blueprint/select' || location.path === '/blueprint/deeplink' ) {
				createSiteProps.setSelectedBlueprint();
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
		createSiteProps,
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
					{ ...createSiteProps }
					blueprintPreferredVersions={ blueprintPreferredVersions }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite { ...createSiteProps } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink">
				<BlueprintDeeplink
					selectedBlueprint={ selectedBlueprint }
					warnings={ blueprintDeeplinkWarnings }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink/create">
				<CreateSite
					{ ...createSiteProps }
					blueprintPreferredVersions={ blueprintPreferredVersions }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup">
				<ImportBackup
					onFileSelect={ handleBackupFileSelect }
					selectedFile={ createSiteProps.fileForImport }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup/create">
				<CreateSite { ...createSiteProps } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1 flex justify-center" path="/pullRemote">
				<PullRemoteSite
					selectedRemoteSite={ selectedRemoteSite }
					setSelectedRemoteSite={ ( remoteSite?: SyncSite ) => {
						setSelectedRemoteSite( remoteSite );
						if ( remoteSite?.name ) {
							void createSiteProps.handleSiteNameChange( remoteSite.name );
						}
					} }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/pullRemote/create">
				<CreateSite { ...createSiteProps } />
			</Navigator.Screen>
			<Stepper
				currentPath={ location.path }
				onBack={ handleBack }
				onBlueprintContinue={ handleBlueprintContinue }
				onBlueprintDeeplinkContinue={ handleBlueprintDeeplinkContinue }
				onBackupContinue={ handleBackupContinue }
				onPullRemoteContinue={ handlePullRemoteContinue }
				onCreateSubmit={ createSiteProps.handleSubmit }
				canSubmitBlueprint={ !! selectedBlueprint }
				canSubmitBlueprintDeeplink={ !! selectedBlueprint }
				canSubmitBackup={ !! createSiteProps.fileForImport }
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
	blueprintPreferredVersions?: { php?: string; wp?: string };
	setBlueprintPreferredVersions?: ( versions: { php?: string; wp?: string } | undefined ) => void;
	blueprintDeeplinkWarnings?: BlueprintValidationWarning[];
	setBlueprintDeeplinkWarnings?: ( warnings: BlueprintValidationWarning[] | undefined ) => void;
	isDeeplinkFlow?: boolean;
	setIsDeeplinkFlow?: ( isDeeplink: boolean ) => void;
	addSiteProps?: ReturnType< typeof useAddSite >;
}

export function AddSiteModalContent( {
	isOpen = true,
	onSubmit,
	className,
	blueprintPreferredVersions,
	setBlueprintPreferredVersions,
	blueprintDeeplinkWarnings,
	setBlueprintDeeplinkWarnings,
	isDeeplinkFlow = false,
	setIsDeeplinkFlow = () => {},
	addSiteProps: externalAddSiteProps,
}: AddSiteModalContentProps ) {
	const { __ } = useI18n();
	const [ nameSuggested, setNameSuggested ] = useState( false );
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );

	const {
		data: blueprintsData,
		isLoading: isLoadingBlueprints,
		error: blueprintsError,
	} = useGetBlueprints();

	const localAddSiteProps = useAddSite();
	const addSiteProps = externalAddSiteProps ?? localAddSiteProps;

	const {
		handleAddSiteClick,
		siteName,
		setSiteName,
		setPhpVersion,
		setWpVersion,
		setProposedSitePath,
		setSitePath,
		setError,
		setDoesPathContainWordPress,
		loadingSites,
		sites,
		setUseCustomDomain,
		setCustomDomain,
		setCustomDomainError,
		setEnableHttps,
		setFileForImport,
		loadAllCustomDomains,
		selectedBlueprint,
		setSelectedBlueprint,
		selectedRemoteSite,
		setSelectedRemoteSite,
	} = addSiteProps;

	const minimumWordPressVersion = useRootSelector( selectMinimumWordPressVersion );
	const { data: versions = [] } = useGetWordPressVersions( {
		minimumVersion: minimumWordPressVersion,
	} );
	const latestStableVersion = versions.find( ( version ) => version.value === 'latest' );

	const resetForm = useCallback( () => {
		setNameSuggested( false );
		setSitePath( '' );
		setDoesPathContainWordPress( false );
		setWpVersion( defaultWordPressVersion );
		setPhpVersion( defaultPhpVersion );
		setUseCustomDomain( false );
		setCustomDomain( null );
		setCustomDomainError( '' );
		setEnableHttps( false );
		setFileForImport( null );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions?.( undefined );
		setBlueprintDeeplinkWarnings?.( undefined );
		setSelectedRemoteSite( undefined );
	}, [
		setSitePath,
		setDoesPathContainWordPress,
		setPhpVersion,
		setWpVersion,
		setUseCustomDomain,
		setCustomDomain,
		setCustomDomainError,
		setEnableHttps,
		setFileForImport,
		setSelectedBlueprint,
		setSelectedRemoteSite,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		defaultWordPressVersion,
		defaultPhpVersion,
	] );

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
		setSitePath( '' );
		setError( '' );
		setDoesPathContainWordPress( isWordPress );
		loadAllCustomDomains();
	}, [
		sites,
		setSiteName,
		setProposedSitePath,
		setSitePath,
		setError,
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

	// Reset form when closed
	useEffect( () => {
		if ( ! isOpen ) {
			resetForm();
		}
	}, [ isOpen, resetForm ] );

	const handleSubmit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			onSubmit?.();
			await handleAddSiteClick();
			speak( siteAddedMessage );
			setNameSuggested( false );
		},
		[ handleAddSiteClick, siteAddedMessage, onSubmit ]
	);

	return (
		<Navigator
			className={ className ?? 'w-full h-full app-no-drag-region' }
			initialPath={ initialNavigatorPath }
		>
			<NavigationContent
				{ ...addSiteProps }
				selectedBlueprint={ selectedBlueprint }
				setSelectedBlueprint={ setSelectedBlueprint }
				blueprintsData={ blueprintsData }
				blueprintsErrorMessage={ formatRtkError( blueprintsError ) }
				isLoadingBlueprints={ isLoadingBlueprints }
				handleSubmit={ handleSubmit }
				blueprintPreferredVersions={ blueprintPreferredVersions }
				setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
				blueprintDeeplinkWarnings={ blueprintDeeplinkWarnings }
				selectedRemoteSite={ selectedRemoteSite }
				setSelectedRemoteSite={ setSelectedRemoteSite }
				isDeeplinkFlow={ isDeeplinkFlow }
				setIsDeeplinkFlow={ setIsDeeplinkFlow }
			/>
		</Navigator>
	);
}

interface AddSiteContentWithDeeplinkSupportProps {
	isOpen?: boolean;
	onSubmit?: () => void;
	openModal?: () => void;
	isAnySiteProcessing?: boolean;
}

export function AddSiteContentWithDeeplinkSupport( {
	isOpen = true,
	onSubmit,
	openModal = () => {},
	isAnySiteProcessing = false,
}: AddSiteContentWithDeeplinkSupportProps ) {
	const addSiteProps = useAddSite();
	const { setSelectedBlueprint, setPhpVersion, setWpVersion, sites } = addSiteProps;

	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		{ php?: string; wp?: string } | undefined
	>();
	const [ blueprintDeeplinkWarnings, setBlueprintDeeplinkWarnings ] = useState<
		BlueprintValidationWarning[] | undefined
	>();
	const [ isDeeplinkFlow, setIsDeeplinkFlow ] = useState( false );

	useBlueprintDeeplink( {
		isAnySiteProcessing: isAnySiteProcessing || sites.some( ( site ) => site.isAddingSite ),
		openModal,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		navigateToBlueprintDeeplink: () => {
			setIsDeeplinkFlow( true );
		},
	} );

	return (
		<AddSiteModalContent
			isOpen={ isOpen }
			onSubmit={ onSubmit }
			blueprintPreferredVersions={ blueprintPreferredVersions }
			setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
			blueprintDeeplinkWarnings={ blueprintDeeplinkWarnings }
			setBlueprintDeeplinkWarnings={ setBlueprintDeeplinkWarnings }
			isDeeplinkFlow={ isDeeplinkFlow }
			setIsDeeplinkFlow={ setIsDeeplinkFlow }
			addSiteProps={ addSiteProps }
		/>
	);
}

interface AddSiteModalProps {
	className?: string;
}

export default function AddSiteModal( { className }: AddSiteModalProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );
	const { importState } = useImportExport();

	const addSiteProps = useAddSite();
	const { sites, setSelectedBlueprint, setPhpVersion, setWpVersion } = addSiteProps;

	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		{ php?: string; wp?: string } | undefined
	>();
	const [ blueprintDeeplinkWarnings, setBlueprintDeeplinkWarnings ] = useState<
		BlueprintValidationWarning[] | undefined
	>();
	const [ isDeeplinkFlow, setIsDeeplinkFlow ] = useState( false );

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding: false, isAddSiteVisible: showModal } );
	}, [ showModal ] );

	const openModal = useCallback( () => {
		setShowModal( true );
	}, [] );

	const closeModal = useCallback( () => {
		setShowModal( false );
		setIsDeeplinkFlow( false );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintDeeplinkWarnings( undefined );
		addSiteProps.setFileForImport( null );
	}, [ setSelectedBlueprint, addSiteProps ] );

	const handleSiteAdded = useCallback( () => {
		closeModal();
	}, [ closeModal ] );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	// This hook must also be here because FullscreenModal doesn't render children when closed.
	// AddSiteModal and NoStudioSites (which uses AddSiteContentWithDeeplinkSupport)
	// are mutually exclusive, only one is mounted based on whether sites exist.
	useBlueprintDeeplink( {
		isAnySiteProcessing,
		openModal,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		navigateToBlueprintDeeplink: () => {
			setIsDeeplinkFlow( true );
		},
	} );

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				<AddSiteModalContent
					isOpen={ showModal }
					onSubmit={ handleSiteAdded }
					blueprintPreferredVersions={ blueprintPreferredVersions }
					setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
					blueprintDeeplinkWarnings={ blueprintDeeplinkWarnings }
					setBlueprintDeeplinkWarnings={ setBlueprintDeeplinkWarnings }
					isDeeplinkFlow={ isDeeplinkFlow }
					setIsDeeplinkFlow={ setIsDeeplinkFlow }
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
