import { FormToggle } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback } from 'react';
import { useOffline } from '../hooks/use-offline';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import Modal from './modal';
import offlineIcon from './offline-icon';
import Tooltip from './tooltip';

const DeleteSite = () => {
	const { __ } = useI18n();
	const { selectedSite, deleteSite, isDeleting, deleteError } = useSiteDetails();
	const isOffline = useOffline();
	const [ needsConfirmation, setNeedsConfirmation ] = useState( false );
	const [ deleteLocalFiles, setDeleteLocalFiles ] = useState( false );

	const offlineMessage = __(
		'This site has active demo sites that cannot be deleted without an internet connection.'
	);
	const isSiteDeletionDisabled = ! selectedSite || isOffline;

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
					title={ sprintf( __( 'Delete %s' ), selectedSite.name ) }
					closeButtonLabel={ __( 'Close' ) }
					isDismissible
					onRequestClose={ resetLocalState }
				>
					<p>
						{ __(
							"The site's database, along with all posts, pages, comments, and media, will be lost."
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
							onClick={ () => {
								resetLocalState();
								onSiteDelete( selectedSite.id, deleteLocalFiles );
							} }
							isDestructive
							variant="primary"
						>
							{ __( 'Delete site' ) }
						</Button>
					</div>
				</Modal>
			) }
			<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
				<Button
					aria-description={ isOffline ? offlineMessage : '' }
					aria-disabled={ isSiteDeletionDisabled }
					onClick={ () => {
						if ( isSiteDeletionDisabled ) {
							return;
						}
						setNeedsConfirmation( true );
					} }
					variant="link"
					isDestructive
				>
					{ __( 'Delete site' ) }
				</Button>
			</Tooltip>
		</>
	);
};
export default DeleteSite;
