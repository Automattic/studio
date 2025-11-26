import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Button, { ButtonVariant } from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import { useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { formatRtkError } from 'src/stores/format-rtk-error';
import {
	selectDefaultPhpVersion,
	selectDefaultWordPressVersion,
	selectMinimumWordPressVersion,
} from 'src/stores/provider-constants-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { useGetBlueprints, Blueprint } from 'src/stores/wpcom-api';
import { AddSiteBlueprintSelector } from './components/blueprints';
import CreateSite from './components/create-site';
import ImportBackup from './components/import-backup';
import AddSiteOptions, { type AddSiteFlowType } from './components/options';
import { PullRemoteSite } from './components/pull-remote-site';
import Stepper from './components/stepper';
import { useBlueprintDeeplink } from './hooks/use-blueprint-deeplink';
import { createNodeFsMountHandler } from '@php-wasm/node';

interface AddSiteProps {
	className?: string;
	variant?: ButtonVariant;
	withCtaButton?: boolean;
}

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
	setBlueprintPreferredVersions: ( versions: { php?: string; wp?: string } | undefined ) => void;
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
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
		selectedRemoteSite,
		setSelectedRemoteSite,
		...createSiteProps
	} = props;

	const { setSelectedBlueprint, setPhpVersion, setWpVersion } = createSiteProps;

	const handleOptionSelect = useCallback(
		( option: AddSiteFlowType ) => {
			if ( option === 'blueprint' ) {
				goTo( '/blueprint' );
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
		if ( createSiteProps.selectedBlueprint ) {
			goTo( '/blueprint/create' );
		}
	}, [ createSiteProps.selectedBlueprint, goTo ] );

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
		location.path === '/blueprint/create' ||
		location.path === '/backup/create' ||
		location.path === '/pullRemote/create';
	const canSubmit =
		isOnCreatePath &&
		createSiteProps.siteName?.trim() &&
		! createSiteProps.error &&
		( ! createSiteProps.useCustomDomain || ! createSiteProps.customDomainError );

	const handleBack = useCallback( () => {
		if ( location.path === '/blueprint/create' ) {
			goTo( '/blueprint' );
		} else if ( location.path === '/backup/create' ) {
			goTo( '/backup' );
		} else if ( location.path === '/pullRemote/create' ) {
			goTo( '/pullRemote' );
		} else if (
			location.path === '/backup' ||
			location.path === '/blueprint' ||
			location.path === '/create' ||
			location.path === '/pullRemote'
		) {
			if ( location.path === '/backup' ) {
				createSiteProps.setFileForImport( null );
			}
			if ( location.path === '/blueprint' ) {
				createSiteProps.setSelectedBlueprint();
				setBlueprintPreferredVersions( undefined );
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
				setBlueprintPreferredVersions( preferredVersions );

				// Apply the preferred versions to the form
				if ( preferredVersions.php && preferredVersions.php !== 'latest' ) {
					setPhpVersion( preferredVersions.php );
				}
				if ( preferredVersions.wp && preferredVersions.wp !== 'latest' ) {
					setWpVersion( preferredVersions.wp );
				}
			} else {
				setBlueprintPreferredVersions( undefined );
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
			<Navigator.Screen className="flex-1" path="/blueprint">
				<AddSiteBlueprintSelector
					blueprints={ blueprints }
					errorMessage={ blueprintsErrorMessage }
					isLoading={ isLoadingBlueprints }
					selectedBlueprint={ createSiteProps.selectedBlueprint?.slug || null }
					onBlueprintChange={ handleBlueprintChange }
					onFileBlueprintSelect={ handleFileBlueprintSelect }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/create">
				<CreateSite
					{ ...createSiteProps }
					blueprintPreferredVersions={ blueprintPreferredVersions }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite { ...createSiteProps } />
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
			<Navigator.Screen className="flex-1" path="/pullRemote">
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
				onBackupContinue={ handleBackupContinue }
				onPullRemoteContinue={ handlePullRemoteContinue }
				onCreateSubmit={ createSiteProps.handleSubmit }
				canSubmitBlueprint={ !! createSiteProps.selectedBlueprint }
				canSubmitBackup={ !! createSiteProps.fileForImport }
				canSubmitPullRemote={ !! selectedRemoteSite }
				canSubmitCreate={ !! canSubmit }
			/>
		</>
	);
}

export default function AddSite( {
	className,
	variant = 'outlined',
	withCtaButton = true,
}: AddSiteProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );
	const [ nameSuggested, setNameSuggested ] = useState( false );
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );
	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		{ php?: string; wp?: string } | undefined
	>();

	const {
		data: blueprintsData,
		isLoading: isLoadingBlueprints,
		refetch,
		isUninitialized,
		error: blueprintsError,
	} = useGetBlueprints();

	const { importState } = useImportExport();
	const addSiteProps = useAddSite();
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

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

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
		setBlueprintPreferredVersions( undefined );
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
		defaultWordPressVersion,
		defaultPhpVersion,
	] );

	const openModal = useCallback( () => {
		if ( ! isUninitialized ) {
			void refetch();
		}
		setShowModal( true );
	}, [ refetch, isUninitialized ] );

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		openModal,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
	} );

	const initialNavigatorPath = selectedBlueprint ? '/blueprint/create' : '/';

	const closeModal = useCallback( () => {
		setShowModal( false );
		resetForm();
	}, [ resetForm ] );

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
		if ( ( showModal || ! withCtaButton ) && ! nameSuggested && ! loadingSites ) {
			void initializeForm();
		}
	}, [ showModal, withCtaButton, nameSuggested, loadingSites, initializeForm ] );

	const handleSubmit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			closeModal();
			await handleAddSiteClick();
			speak( siteAddedMessage );
			setNameSuggested( false );
		},
		[ handleAddSiteClick, siteAddedMessage, closeModal ]
	);

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	const WrapperContent = (
		<Navigator className="w-full h-full" initialPath={ initialNavigatorPath }>
			<NavigationContent
				{ ...addSiteProps }
				blueprintsData={ blueprintsData }
				blueprintsErrorMessage={ formatRtkError( blueprintsError ) }
				isLoadingBlueprints={ isLoadingBlueprints }
				handleSubmit={ handleSubmit }
				blueprintPreferredVersions={ blueprintPreferredVersions }
				setBlueprintPreferredVersions={ setBlueprintPreferredVersions }
				selectedRemoteSite={ selectedRemoteSite }
				setSelectedRemoteSite={ setSelectedRemoteSite }
			/>
		</Navigator>
	);

	if ( ! withCtaButton ) {
		return WrapperContent;
	}

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				{ WrapperContent }
			</FullscreenModal>
			<Button
				variant={ variant }
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
