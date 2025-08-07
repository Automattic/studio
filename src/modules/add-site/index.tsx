import { speak } from '@wordpress/a11y';
import { Navigator, useNavigator } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import {
	selectDefaultPhpVersion,
	selectDefaultWordPressVersion,
} from 'src/stores/provider-constants-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { useGetBlueprints } from 'src/stores/wpcom-api';
import AddSiteLegacy from './components/add-site-legacy';
import AddSiteBlueprintSelector from './components/blueprints';
import CreateSite from './components/create-site';
import ImportBackup from './components/import-backup';
import AddSiteOptions from './components/options';
import Stepper from './components/stepper';

interface AddSiteProps {
	className?: string;
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
	setFileForImport: ( file: File | null ) => void;
}

function NavigationContent( props: NavigationContentProps ) {
	const { __ } = useI18n();
	const { goTo, location } = useNavigator();
	const { blueprintsData, isLoadingBlueprints, ...createSiteProps } = props;
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< string | null >( null );
	const [ backupFile, setBackupFile ] = useState< File | null >( null );

	const handleOptionSelect = useCallback(
		( option: 'create' | 'blueprint' | 'backup' ) => {
			if ( option === 'blueprint' ) {
				goTo( '/blueprint' );
			} else if ( option === 'create' ) {
				goTo( '/create' );
			} else if ( option === 'backup' ) {
				goTo( '/backup' );
			}
		},
		[ goTo ]
	);

	const handleBlueprintSelect = useCallback(
		( blueprintId: string ) => {
			// TODO: Store the selected blueprint ID
			console.log( 'Selected blueprint:', blueprintId );
			goTo( '/blueprint/create' );
		},
		[ goTo ]
	);

	const handleBlueprintContinue = useCallback( () => {
		if ( selectedBlueprint ) {
			handleBlueprintSelect( selectedBlueprint );
		}
	}, [ selectedBlueprint, handleBlueprintSelect ] );

	const handleBackupFileSelect = useCallback(
		( file: File ) => {
			setBackupFile( file );
			createSiteProps.setFileForImport( file );
		},
		[ createSiteProps ]
	);

	const handleBackupContinue = useCallback( () => {
		if ( backupFile ) {
			goTo( '/backup/create' );
		}
	}, [ backupFile, goTo ] );

	const blueprints = useMemo(
		() => blueprintsData.blueprints.slice().reverse() || [],
		[ blueprintsData ]
	);

	const isOnCreatePath =
		location.path === '/create' ||
		location.path === '/blueprint/create' ||
		location.path === '/backup/create';
	const canSubmit =
		isOnCreatePath &&
		createSiteProps.siteName?.trim() &&
		! createSiteProps.error &&
		( ! createSiteProps.useCustomDomain || ! createSiteProps.customDomainError );

	const handleBack = useCallback( () => {
		if ( location.path === '/blueprint/create' ) {
			goTo( '/blueprint' );
		} else if ( location.path === '/backup/create' ) {
			setBackupFile( null );
			createSiteProps.setFileForImport( null );
			goTo( '/backup' );
		} else if (
			location.path === '/backup' ||
			location.path === '/blueprint' ||
			location.path === '/create'
		) {
			if ( location.path === '/backup' ) {
				setBackupFile( null );
				createSiteProps.setFileForImport( null );
			}
			goTo( '/' );
		} else {
			goTo( '/' );
		}
	}, [ goTo, location.path, createSiteProps ] );

	return (
		<>
			<Navigator.Screen className="flex-1" path="/">
				<AddSiteOptions onOptionSelect={ handleOptionSelect } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint">
				<AddSiteBlueprintSelector
					blueprints={ blueprints }
					isLoading={ isLoadingBlueprints }
					selectedBlueprint={ selectedBlueprint }
					onBlueprintChange={ setSelectedBlueprint }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/create">
				<CreateSite { ...createSiteProps } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite { ...createSiteProps } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup">
				<ImportBackup onFileSelect={ handleBackupFileSelect } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup/create">
				<CreateSite { ...createSiteProps } />
			</Navigator.Screen>
			<Stepper
				currentPath={ location.path }
				onBack={ handleBack }
				onSubmit={
					location.path === '/blueprint'
						? handleBlueprintContinue
						: location.path === '/backup'
						? handleBackupContinue
						: () => createSiteProps.handleSubmit( { preventDefault: () => {} } as FormEvent )
				}
				canSubmit={
					location.path === '/blueprint'
						? !! selectedBlueprint
						: location.path === '/backup'
						? !! backupFile
						: !! canSubmit
				}
			/>
		</>
	);
}

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { enableBlueprints } = useFeatureFlags();
	const [ showModal, setShowModal ] = useState( false );
	const [ nameSuggested, setNameSuggested ] = useState( false );
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );

	const {
		data: blueprintsData,
		isLoading: isLoadingBlueprints,
		refetch,
		isUninitialized,
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
	} = addSiteProps;

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const { data: versions = [] } = useGetWordPressVersions();
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
		defaultWordPressVersion,
		defaultPhpVersion,
	] );

	const openModal = useCallback( () => {
		if ( ! isUninitialized ) {
			void refetch();
		}
		setShowModal( true );
	}, [ refetch, isUninitialized ] );

	const closeModal = useCallback( () => {
		setShowModal( false );
		resetForm();
	}, [ resetForm ] );

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName
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
		if ( showModal && ! nameSuggested && ! loadingSites ) {
			void initializeForm();
		}
	}, [ showModal, nameSuggested, loadingSites, initializeForm ] );

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

	if ( ! enableBlueprints ) {
		return (
			<AddSiteLegacy
				className={ className }
				showModal={ showModal }
				setShowModal={ setShowModal }
			/>
		);
	}

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				<Navigator className="w-full h-full" initialPath="/">
					<NavigationContent
						{ ...addSiteProps }
						blueprintsData={ blueprintsData }
						isLoadingBlueprints={ isLoadingBlueprints }
						handleSubmit={ handleSubmit }
					/>
				</Navigator>
			</FullscreenModal>
			<Button
				variant="outlined"
				className={ className }
				onClick={ openModal }
				disabled={ isAnySiteProcessing }
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
