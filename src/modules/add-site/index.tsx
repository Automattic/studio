import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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

type BlueprintsData = ReturnType< typeof useGetBlueprints >[ 'data' ];

interface NavigationContentProps {
	addSiteProps: ReturnType< typeof useAddSite >;
	blueprintsData: BlueprintsData;
	isLoadingBlueprints: boolean;
	handleSubmit: ( event: FormEvent ) => void;
	blueprintsErrorMessage?: string;
}

function NavigationContent( props: NavigationContentProps ) {
	const { __ } = useI18n();
	const { goTo, location } = useNavigator();
	const {
		blueprintsData,
		isLoadingBlueprints,
		blueprintsErrorMessage,
		addSiteProps,
		handleSubmit,
	} = props;

	const {
		setBlueprintPreferredVersions,
		blueprintDeeplinkWarnings,
		selectedRemoteSite,
		setSelectedRemoteSite,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
		selectedBlueprint,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
	} = addSiteProps;

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
			addSiteProps.setFileForImport( file || null );
		},
		[ addSiteProps ]
	);

	const handleBackupContinue = useCallback( () => {
		if ( addSiteProps.fileForImport ) {
			goTo( '/backup/create' );
		}
	}, [ addSiteProps, goTo ] );

	const findAvailableSiteName = useFindAvailableSiteName();
	const handlePullRemoteContinue = useCallback( async () => {
		if ( selectedRemoteSite ) {
			const availableName = await findAvailableSiteName( selectedRemoteSite.name );
			await addSiteProps.handleSiteNameChange( availableName );
			goTo( '/pullRemote/create' );
		}
	}, [ addSiteProps, findAvailableSiteName, goTo, selectedRemoteSite ] );

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
		addSiteProps.siteName?.trim() &&
		! addSiteProps.error &&
		( ! addSiteProps.useCustomDomain || ! addSiteProps.customDomainError );

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
				addSiteProps.setFileForImport( null );
			}
			if ( location.path === '/blueprint/select' || location.path === '/blueprint/deeplink' ) {
				addSiteProps.setSelectedBlueprint( undefined );
				setBlueprintPreferredVersions?.( undefined );
			}
			if ( location.path === '/pullRemote' ) {
				setSelectedRemoteSite( undefined );
			}
			goTo( '/' );
		} else {
			goTo( '/' );
		}
	}, [ location.path, goTo, addSiteProps, setBlueprintPreferredVersions, setSelectedRemoteSite ] );

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
				<CreateSite addSiteProps={ addSiteProps } handleSubmit={ handleSubmit } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite addSiteProps={ addSiteProps } handleSubmit={ handleSubmit } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink">
				<BlueprintDeeplink
					selectedBlueprint={ selectedBlueprint }
					warnings={ blueprintDeeplinkWarnings }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink/create">
				<CreateSite addSiteProps={ addSiteProps } handleSubmit={ handleSubmit } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup">
				<ImportBackup
					onFileSelect={ handleBackupFileSelect }
					selectedFile={ addSiteProps.fileForImport }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup/create">
				<CreateSite addSiteProps={ addSiteProps } handleSubmit={ handleSubmit } />
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
				<CreateSite addSiteProps={ addSiteProps } handleSubmit={ handleSubmit } />
			</Navigator.Screen>
			<Stepper
				currentPath={ location.path }
				onBack={ handleBack }
				onBlueprintContinue={ handleBlueprintContinue }
				onBlueprintDeeplinkContinue={ handleBlueprintDeeplinkContinue }
				onBackupContinue={ handleBackupContinue }
				onPullRemoteContinue={ handlePullRemoteContinue }
				onCreateSubmit={ handleSubmit }
				canSubmitBlueprint={ !! selectedBlueprint }
				canSubmitBlueprintDeeplink={ !! selectedBlueprint }
				canSubmitBackup={ !! addSiteProps.fileForImport }
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
				addSiteProps={ addSiteProps }
				blueprintsData={ blueprintsData }
				blueprintsErrorMessage={ formatRtkError( blueprintsError ) }
				isLoadingBlueprints={ isLoadingBlueprints }
				handleSubmit={ handleSubmit }
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
