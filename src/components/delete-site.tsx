import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useOffline } from '../hooks/use-offline';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import offlineIcon from './offline-icon';
import Tooltip from './tooltip';

const MAX_LENGTH_SITE_TITLE = 35;

const DeleteSite = () => {
	const { __ } = useI18n();
	const { selectedSite, deleteSite, isDeleting } = useSiteDetails();
	const isOffline = useOffline();

	const offlineMessage = __(
		'This site has active demo sites that cannot be deleted without an internet connection.'
	);

	const { snapshots } = useSiteDetails();
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
				"The site's database, along with all posts, pages, comments, and media, will be lost."
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
				await showErrorMessageBox( error, trimmedSiteTitle );
				Sentry.captureException( error );
			}
		}
	};

	const showErrorMessageBox = async ( error: unknown, siteTitle: string ) => {
		getIpcApi().showMessageBox( {
			type: 'warning',
			message: __( 'Deletion failed' ),
			detail: sprintf( __( "We couldn't delete the site '%s'. Please try again" ), siteTitle ),
			buttons: [ __( 'OK' ) ],
		} );
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
		>
			<Button
				aria-description={ isOffline && snapshotsOnSite.length > 0 ? offlineMessage : '' }
				aria-disabled={ isSiteDeletionDisabled }
				onClick={ () => {
					if ( isSiteDeletionDisabled ) {
						return;
					}
					handleDeleteSite();
				} }
				variant="link"
				isDestructive
			>
				{ __( 'Delete site' ) }
			</Button>
		</Tooltip>
	);
};
export default DeleteSite;
