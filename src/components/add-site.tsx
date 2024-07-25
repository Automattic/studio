import { speak } from '@wordpress/a11y';
import { Icon } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAddSite } from '../hooks/use-add-site';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useSiteDetails } from '../hooks/use-site-details';
import { generateSiteName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import Modal from './modal';
import { SiteForm } from './site-form';

interface AddSiteProps {
	className?: string;
}

const acceptedFileTypes = [
	'application/zip',
	'application/x-gzip',
	'application/sql',
	'application/x-tar',
];

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );
	const [ nameSuggested, setNameSuggested ] = useState( false );
	const [ fileError, setFileError ] = useState( '' );

	const { data } = useSiteDetails();

	const {
		handleAddSiteClick,
		siteName,
		setSiteName,
		setProposedSitePath,
		sitePath,
		setSitePath,
		error,
		setError,
		doesPathContainWordPress,
		setDoesPathContainWordPress,
		handleSiteNameChange,
		handlePathSelectorClick,
		usedSiteNames,
		loadingSites,
		fileForImport,
		setFileForImport,
	} = useAddSite();

	const isSiteAdding = data.some( ( site ) => site.isAddingSite );

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName
	);

	const initializeForm = useCallback( async () => {
		const { name, path, isWordPress } =
			( await getIpcApi().generateProposedSitePath( generateSiteName( usedSiteNames ) ) ) || {};
		setNameSuggested( true );
		setSiteName( name );
		setProposedSitePath( path );
		setSitePath( '' );
		setError( '' );
		setDoesPathContainWordPress( isWordPress );
	}, [
		usedSiteNames,
		setSiteName,
		setProposedSitePath,
		setSitePath,
		setError,
		setDoesPathContainWordPress,
	] );

	useEffect( () => {
		if ( showModal && ! nameSuggested && ! loadingSites ) {
			initializeForm();
		}
	}, [ showModal, nameSuggested, loadingSites, initializeForm ] );

	const openModal = useCallback( async () => {
		setShowModal( true );
	}, [] );

	const closeModal = useCallback( () => {
		setShowModal( false );
		setNameSuggested( false );
		setSitePath( '' );
		setDoesPathContainWordPress( false );
		setFileForImport( null );
		setFileError( '' );
	}, [ setSitePath, setDoesPathContainWordPress, setFileForImport ] );

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
		async ( file: File ) => {
			setFileForImport( file );
		},
		[ setFileForImport ]
	);

	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			if ( acceptedFileTypes.includes( file.type ) ) {
				setFileForImport( file );
				setFileError( '' );
			} else {
				setFileError( __( 'Invalid file type. Please select a valid backup file.' ) );
				setFileForImport( null );
			}
		},
	} );

	useIpcListener( 'add-site', () => {
		if ( isSiteAdding ) {
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
				>
					<div ref={ dropRef }>
						{ isDraggingOver && (
							<div className="absolute inset-0 bg-white bg-opacity-80 z-10 backdrop-blur-sm flex flex-col items-center justify-center">
								<Icon width={ 32 } height={ 34 } icon={ download } className="fill-a8c-blueberry" />
								<span className="text-[13px] leading-[16px] text-black mt-4">
									{ __( 'Drop backup to import' ) }
								</span>
							</div>
						) }
						<SiteForm
							siteName={ siteName || '' }
							setSiteName={ handleSiteNameChange }
							sitePath={ sitePath }
							onSelectPath={ handlePathSelectorClick }
							error={ error }
							onSubmit={ handleSubmit }
							doesPathContainWordPress={ doesPathContainWordPress }
							fileForImport={ fileForImport }
							setFileForImport={ setFileForImport }
							onFileSelected={ handleImportFile }
							fileError={ fileError }
						>
							<div className="flex flex-row justify-end gap-x-5 mt-6">
								<Button onClick={ closeModal } disabled={ isSiteAdding } variant="tertiary">
									{ __( 'Cancel' ) }
								</Button>
								<Button
									type="submit"
									variant="primary"
									isBusy={ isSiteAdding }
									disabled={ isSiteAdding || !! error || ! siteName?.trim() }
								>
									{ __( 'Add site' ) }
								</Button>
							</div>
						</SiteForm>
					</div>
				</Modal>
			) }
			<Button
				variant="outlined"
				className={ className }
				onClick={ openModal }
				disabled={ isSiteAdding }
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
