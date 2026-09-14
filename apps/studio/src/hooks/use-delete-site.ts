import { __, sprintf } from '@wordpress/i18n';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

const MAX_LENGTH_SITE_TITLE = 35;

const getTrimmedSiteTitle = ( name: string ) =>
	name.length > MAX_LENGTH_SITE_TITLE
		? `${ name.substring( 0, MAX_LENGTH_SITE_TITLE - 3 ) }…`
		: name;

export function useDeleteSite() {
	const { deleteSite } = useSiteDetails();

	const handleDeleteSite = async ( siteId: string, siteName: string ) => {
		const DELETE_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const trimmedSiteTitle = getTrimmedSiteTitle( siteName );
		const ipcApi = getIpcApi();

		const { response, checkboxChecked } = await ipcApi.showMessageBox( {
			type: 'warning',
			message: sprintf( __( 'Delete %s' ), trimmedSiteTitle ),
			detail: __(
				"The site's database will be lost, including all posts, pages, comments, and media."
			),
			buttons: [ __( 'Delete site' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
			checkboxLabel: __( 'Delete site files from my computer' ),
			checkboxChecked: true,
		} );

		if ( response === DELETE_BUTTON_INDEX ) {
			try {
				await deleteSite( siteId, checkboxChecked );
			} catch ( error ) {
				ipcApi.showErrorMessageBox( {
					title: __( 'Deletion failed' ),
					message: sprintf(
						__( "We couldn't delete the site '%s'. Please try again" ),
						trimmedSiteTitle
					),
					error,
				} );
			}
		}
	};

	return { handleDeleteSite };
}
