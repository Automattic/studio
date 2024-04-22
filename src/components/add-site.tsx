import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAddSite } from '../hooks/use-add-site';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { cx } from '../lib/cx';
import { generateSiteName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import Modal from './modal';
import { SiteForm } from './site-form';

interface AddSiteProps {
	className?: string;
}

/**
 * The arbitrary Tailwind variants below (e.g., `[&.is-secondary]`) are used to
 * achieve the specificity required to override the default button styles
 * without `!important`, which often creates specificity collisions.
 */
const buttonStyles = `
add-site
text-white
[&.components-button]:hover:text-black
[&.components-button]:hover:bg-gray-100
[&.components-button]:active:text-black
[&.components-button]:active:bg-gray-100
[&.components-button]:shadow-[inset_0_0_0_1px_white]
[&.components-button.add-site]:focus:shadow-[inset_0_0_0_1px_white]
[&.components-button]:focus-visible:outline-none
[&.components-button.add-site]:focus-visible:shadow-[inset_0_0_0_1px_#3858E9]
[&.components-button]:focus-visible:shadow-a8c-blueberry
`.replace( /\n/g, ' ' );

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );
	const [ nameSuggested, setNameSuggested ] = useState( false );

	const {
		handleAddSiteClick,
		isAddingSite,
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
	} = useAddSite();

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
				await handleAddSiteClick();
				speak( siteAddedMessage );
				setNameSuggested( false );
				closeModal();
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ handleAddSiteClick, closeModal, siteAddedMessage ]
	);

	useIpcListener( 'add-site', () => {
		openModal();
	} );

	return (
		<>
			{ showModal && ! loadingSites && (
				<Modal
					className="w-[460px]"
					title={ __( 'Add a site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
				>
					<SiteForm
						siteName={ siteName || '' }
						setSiteName={ handleSiteNameChange }
						sitePath={ sitePath }
						onSelectPath={ handlePathSelectorClick }
						error={ error }
						onSubmit={ handleSubmit }
						doesPathContainWordPress={ doesPathContainWordPress }
					>
						<div className="flex flex-row justify-end gap-x-5 mt-6">
							<Button onClick={ closeModal } disabled={ isAddingSite } variant="tertiary">
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isAddingSite }
								disabled={ !! error || ! siteName?.trim() }
							>
								{ isAddingSite ? __( 'Adding site…' ) : __( 'Add site' ) }
							</Button>
						</div>
					</SiteForm>
				</Modal>
			) }
			<Button className={ cx( buttonStyles, className ) } onClick={ openModal }>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
