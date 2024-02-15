import { Modal, FormToggle } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';

const DeleteSite = () => {
	const { __ } = useI18n();
	const { selectedSite, deleteSite, isDeleting, deleteError } = useSiteDetails();
	const [ needsConfirmation, setNeedsConfirmation ] = useState( false );
	const [ deleteLocalFiles, setDeleteLocalFiles ] = useState( false );

	const resetLocalState = useCallback( () => {
		setDeleteLocalFiles( false );
		setNeedsConfirmation( false );
	}, [] );

	const onSiteDelete = useCallback(
		async ( id: string, deleteLocalFiles: boolean ) => {
			try {
				await deleteSite( id, deleteLocalFiles );
				setNeedsConfirmation( false );
			} catch ( e ) {
				/* empty */
			}
		},
		[ deleteSite ]
	);

	return (
		<>
			{ needsConfirmation && selectedSite?.id && (
				<Modal
					className="[&_h1]:!text-xl [&_h1]:!font-normal outline-0"
					title={ sprintf( __( 'Delete %s' ), selectedSite.name ) }
					closeButtonLabel={ __( 'Close' ) }
					isDismissible
					onRequestClose={ resetLocalState }
				>
					<p>
						{ __(
							'The sites database along with all posts, pages, comments and media will be lost.'
						) }
					</p>
					<div className="my-6">
						<label className="flex items-center gap-x-chrome">
							<FormToggle
								checked={ deleteLocalFiles }
								onChange={ () => setDeleteLocalFiles( ! deleteLocalFiles ) }
							/>
							<span>{ __( 'Delete site files from my computer' ) }</span>
						</label>
					</div>
					{ deleteError && <p className="text-red-500">{ deleteError }</p> }
					<div className="flex flex-row justify-end gap-x-5">
						<Button disabled={ isDeleting } onClick={ resetLocalState } variant="tertiary">
							{ __( 'Cancel' ) }
						</Button>
						<Button
							disabled={ isDeleting }
							className="bg-a8c-red-50 hover:bg-a8c-red-60 hover:text-white text-white"
							onClick={ () => {
								resetLocalState();
								onSiteDelete( selectedSite.id, deleteLocalFiles );
							} }
						>
							{ __( 'Delete site' ) }
						</Button>
					</div>
				</Modal>
			) }
			<Button
				disabled={ ! selectedSite }
				className="text-a8c-red-50 hover:text-a8c-red-70 !px-0 h-0"
				onClick={ () => setNeedsConfirmation( true ) }
			>
				{ __( 'Delete site' ) }
			</Button>
		</>
	);
};
export default DeleteSite;
