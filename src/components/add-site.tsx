import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
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

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );
	const [ nameSuggested, setNameSuggested ] = useState( false );
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
	}, [ setSitePath, setDoesPathContainWordPress ] );

	const handleSubmit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			try {
				closeModal();
				await handleAddSiteClick();
				speak( siteAddedMessage );
				setNameSuggested( false );
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ handleAddSiteClick, closeModal, siteAddedMessage ]
	);

	const handleImportFile = useCallback(
		async ( file: File ) => {
			setFileForImport( file );
		},
		[ setFileForImport ]
	);
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			setFileForImport( file );
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
