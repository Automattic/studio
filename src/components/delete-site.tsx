import * as Sentry from '@sentry/electron/renderer';
import { MenuItem } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { getIpcApi } from 'src/lib/get-ipc-api';

const MAX_LENGTH_SITE_TITLE = 35;

type DeleteSiteProps = {
	onClose: () => void;
};

const DeleteSite = ( { onClose }: DeleteSiteProps ) => {
	const { __ } = useI18n();
	const { selectedSite, deleteSite, isDeleting } = useSiteDetails();
	const isOffline = useOffline();

	const offlineMessage = __(
		'This site has active preview sites that cannot be deleted without an internet connection.'
	);

	const { snapshots } = useSnapshots();
	const snapshotsOnSite = snapshots.filter(
		( snapshot ) => snapshot.localSiteId === selectedSite?.id
	);

	const handleDeleteSite = async () => {
		if ( ! selectedSite ) {
			return;
		}

		const DELETE_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const trimmedSiteTitle = getTrimmedSiteTitle( selectedSite.name );

		const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
			type: 'warning',
			message: sprintf( __( 'Delete %s' ), trimmedSiteTitle ),
			detail: __(
				'The site’s database will be lost. Including all posts, pages, comments, and media.'
			),
			buttons: [ __( 'Delete site' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
			checkboxLabel: __( 'Delete site files from my computer' ),
			checkboxChecked: true,
		} );

		if ( response === DELETE_BUTTON_INDEX ) {
			try {
				await deleteSite( selectedSite.id, checkboxChecked );
			} catch ( error ) {
				await getIpcApi().showErrorMessageBox( {
					title: __( 'Deletion failed' ),
					message: sprintf(
						__( "We couldn't delete the site '%s'. Please try again" ),
						trimmedSiteTitle
					),
					error,
				} );
				Sentry.captureException( error );
			}
		}
	};

	const getTrimmedSiteTitle = ( name: string ) =>
		name.length > MAX_LENGTH_SITE_TITLE
			? `${ name.substring( 0, MAX_LENGTH_SITE_TITLE - 3 ) }...`
			: name;

	const isSiteDeletionDisabled =
		! selectedSite || ( isOffline && snapshotsOnSite.length > 0 ) || isDeleting;

	return (
		<Tooltip
			disabled={ ! ( isOffline && snapshotsOnSite.length > 0 ) }
			icon={ offlineIcon }
			text={ offlineMessage }
			placement="top-start"
		>
			<MenuItem
				onClick={ () => {
					if ( isSiteDeletionDisabled ) {
						return;
					}
					onClose();
					handleDeleteSite();
				} }
				isDestructive
				disabled={ isSiteDeletionDisabled }
			>
				{ __( 'Delete site' ) }
			</MenuItem>
		</Tooltip>
	);
};
export default DeleteSite;
