import { SupportedPHPVersion } from '@php-wasm/universal';
import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button, { ButtonVariant } from 'src/components/button';
import DragAndDropOverlay from 'src/components/drag-and-drop-overlay';
import Modal from 'src/components/modal';
import { SiteForm } from 'src/components/site-form';
import { ACCEPTED_IMPORT_FILE_TYPES } from 'src/constants';
import { useAddSite } from 'src/hooks/use-add-site';
import { useDragAndDropFile } from 'src/hooks/use-drag-and-drop-file';
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

interface AddSiteProps {
	className?: string;
	showModal: boolean;
	setShowModal: ( showModal: boolean ) => void;
	variant?: ButtonVariant;
}

export default function AddSite( {
	className,
	showModal,
	setShowModal,
	variant = 'outlined',
}: AddSiteProps ) {
	const { __ } = useI18n();
	const [ nameSuggested, setNameSuggested ] = useState( false );
	const [ fileError, setFileError ] = useState( '' );
	const defaultPhpVersion = useRootSelector( selectDefaultPhpVersion );
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );

	const {
		handleAddSiteClick,
		siteName,
		setSiteName,
		phpVersion,
		setPhpVersion,
		wpVersion,
		setWpVersion,
		setProposedSitePath,
		sitePath,
		setSitePath,
		error,
		setError,
		doesPathContainWordPress,
		setDoesPathContainWordPress,
		handleSiteNameChange,
		handlePathSelectorClick,
		loadingSites,
		fileForImport,
		setFileForImport,
		sites,
		useCustomDomain,
		setUseCustomDomain,
		customDomain,
		setCustomDomain,
		customDomainError,
		setCustomDomainError,
		enableHttps,
		setEnableHttps,
		loadAllCustomDomains,
	} = useAddSite();
	const { importState } = useImportExport();

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName || ''
	);

	const { data: versions = [] } = useGetWordPressVersions();
	const latestStableVersion = versions.find( ( version ) => version.value === 'latest' );

	const initializeForm = useCallback( async () => {
		const siteName = await generateSiteName( sites );
		const { path, name, isWordPress } = await getIpcApi().generateProposedSitePath( siteName );
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

	const openModal = useCallback( () => {
		setShowModal( true );
	}, [ setShowModal ] );

	const closeModal = useCallback( () => {
		setShowModal( false );
		setNameSuggested( false );
		setSitePath( '' );
		setDoesPathContainWordPress( false );
		setFileForImport( null );
		setFileError( '' );
		setWpVersion( defaultWordPressVersion );
		setPhpVersion( defaultPhpVersion as SupportedPHPVersion );
		setUseCustomDomain( false );
		setCustomDomain( null );
		setCustomDomainError( '' );
		setEnableHttps( false );
	}, [
		setSitePath,
		setDoesPathContainWordPress,
		setFileForImport,
		setPhpVersion,
		setWpVersion,
		setUseCustomDomain,
		setCustomDomain,
		setCustomDomainError,
		setEnableHttps,
		defaultWordPressVersion,
		defaultPhpVersion,
		setShowModal,
	] );

	const handleSubmit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			try {
				closeModal();
				await handleAddSiteClick();
				speak( siteAddedMessage );
				setNameSuggested( false );
				setFileForImport( null );
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ closeModal, setFileForImport, handleAddSiteClick, siteAddedMessage ]
	);

	const handleImportFile = useCallback(
		( file: File ) => {
			setFileForImport( file );
			setFileError( '' );
		},
		[ setFileForImport ]
	);

	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			const isAccepted = ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) =>
				file.name.toLowerCase().endsWith( ext )
			);

			if ( isAccepted ) {
				setFileForImport( file );
				setFileError( '' );
			} else {
				setFileError( __( 'Invalid file type. Please select a valid backup file.' ) );
				setFileForImport( null );
			}
		},
	} );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	return (
		<>
			{ showModal && ! loadingSites && (
				<Modal
					size="medium"
					title={ __( 'Add a site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
					className="max-h-[90%]"
				>
					<div ref={ dropRef }>
						{ isDraggingOver && <DragAndDropOverlay /> }
						<SiteForm
							siteName={ siteName || '' }
							setSiteName={ ( name ) => void handleSiteNameChange( name ) }
							phpVersion={ phpVersion }
							setPhpVersion={ setPhpVersion }
							wpVersion={ wpVersion }
							setWpVersion={ setWpVersion }
							sitePath={ sitePath }
							onSelectPath={ handlePathSelectorClick }
							error={ error }
							onSubmit={ handleSubmit }
							doesPathContainWordPress={ doesPathContainWordPress }
							fileForImport={ fileForImport }
							setFileForImport={ setFileForImport }
							onFileSelected={ handleImportFile }
							fileError={ fileError }
							useCustomDomain={ useCustomDomain }
							setUseCustomDomain={ setUseCustomDomain }
							customDomain={ customDomain }
							setCustomDomain={ setCustomDomain }
							customDomainError={ customDomainError }
							enableHttps={ enableHttps }
							setEnableHttps={ setEnableHttps }
						>
							<div className="flex flex-row justify-end gap-x-5 mt-6">
								<Button onClick={ closeModal } variant="tertiary">
									{ __( 'Cancel' ) }
								</Button>
								<Button
									type="submit"
									variant="primary"
									disabled={
										!! error || ( !! customDomainError && useCustomDomain ) || ! siteName?.trim()
									}
								>
									{ __( 'Add site' ) }
								</Button>
							</div>
							<div className="components-popover__fallback-container"></div>
						</SiteForm>
					</div>
				</Modal>
			) }
			<Button
				variant={ variant }
				className={ className }
				onClick={ openModal }
				disabled={ isAnySiteProcessing }
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
