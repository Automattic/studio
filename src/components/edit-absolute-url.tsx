import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useState } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import Modal from './modal';
import TextControlComponent from './text-control';

export default function EditAbsoluteUrl() {
	const { __ } = useI18n();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ showEditAbsoluteUrlModal, setShowEditAbsoluteUrlModal ] = useState( false );
	const [ localUrl, setLocalUrl ] = useState(
		selectedSite?.absoluteUrl || `http://localhost:${ selectedSite?.port }`
	);

	const onLocalUrlEdit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			if ( ! selectedSite ) {
				return;
			}

			setIsEditingSite( true );
			await updateSite( {
				...selectedSite,
				absoluteUrl: localUrl,
			} );
			if ( selectedSite.running ) {
				await stopServer( selectedSite.id );
				await startServer( selectedSite.id );
			}
			setIsEditingSite( false );
			setShowEditAbsoluteUrlModal( false );
		},
		[ selectedSite, localUrl, updateSite, stopServer, startServer ]
	);

	return (
		<>
			{ showEditAbsoluteUrlModal && (
				<Modal
					size="medium"
					title={ __( 'Edit Local URL' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ () => setShowEditAbsoluteUrlModal( false ) }
				>
					<form onSubmit={ onLocalUrlEdit }>
						<label className="flex flex-col gap-1.5 leading-4 mb-6">
							<span className="font-semibold">{ __( 'Local URL' ) }</span>
							<TextControlComponent onChange={ setLocalUrl } value={ localUrl } />
						</label>
						<div className="flex flex-row justify-end gap-x-5 mt-6">
							<Button
								onClick={ () => setShowEditAbsoluteUrlModal( false ) }
								disabled={ isEditingSite }
								variant="tertiary"
							>
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isEditingSite }
								disabled={ isEditingSite || ! selectedSite || ! localUrl.trim() }
							>
								{ isEditingSite ? __( 'Restarting server…' ) : __( 'Save' ) }
							</Button>
						</div>
					</form>
				</Modal>
			) }
			<Button
				disabled={ ! selectedSite }
				className="!mx-4 shrink-0"
				onClick={ () => {
					if ( selectedSite ) {
						setShowEditAbsoluteUrlModal( true );
					}
				} }
				label={ __( 'Edit Local URL' ) }
				variant="link"
			>
				{ __( 'Edit' ) }
			</Button>
		</>
	);
}
