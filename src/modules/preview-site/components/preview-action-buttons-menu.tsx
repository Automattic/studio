import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useUpdateDemoSite } from 'src/hooks/use-update-demo-site';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface PreviewActionButtonsMenuProps {
	snapshot: Snapshot;
	selectedSite: SiteDetails;
}

export function PreviewActionButtonsMenu( {
	snapshot,
	selectedSite,
}: PreviewActionButtonsMenuProps ) {
	const { __ } = useI18n();
	const { deleteSnapshot } = useSnapshots();
	const { updateDemoSite } = useUpdateDemoSite();

	const handleUpdateDemoSite = async () => {
		const dontShowUpdateWarning = localStorage.getItem( 'dontShowUpdateWarning' );

		if ( ! dontShowUpdateWarning ) {
			const UPDATE_BUTTON_INDEX = 0;
			const CANCEL_BUTTON_INDEX = 1;

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				type: 'info',
				message: __( 'Overwrite preview' ),
				detail: __(
					"Updating will replace the existing files and database with a copy from your local site. Any changes you've made to your preview site will be permanently lost."
				),
				buttons: [ __( 'Update' ), __( 'Cancel' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
				checkboxLabel: __( "Don't show this warning again" ),
				checkboxChecked: false,
			} );

			if ( response === UPDATE_BUTTON_INDEX ) {
				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowUpdateWarning', 'true' );
				}
				updateDemoSite( snapshot, selectedSite );
			}
		} else {
			updateDemoSite( snapshot, selectedSite );
		}
	};

	const handleDeleteDemoSite = async () => {
		const { response } = await getIpcApi().showMessageBox( {
			type: 'warning',
			message: __( 'Delete preview' ),
			detail: __(
				'Your previews files and database along with all posts, pages, comments and media will be lost.'
			),
			buttons: [ __( 'Delete' ), __( 'Cancel' ) ],
			cancelId: 1,
		} );

		if ( response === 0 ) {
			deleteSnapshot( snapshot );
		}
	};

	return (
		<DropdownMenu
			icon={ moreVertical }
			label={ __( 'Preview actions' ) }
			className="p-1 flex items-center"
		>
			{ ( { onClose }: { onClose: () => void } ) => (
				<MenuGroup className="w-40 overflow-hidden">
					<MenuItem>
						<span>{ __( 'Rename' ) }</span>
					</MenuItem>
					<MenuItem
						onClick={ () => {
							handleUpdateDemoSite();
							onClose();
						} }
					>
						<span>{ __( 'Update' ) }</span>
					</MenuItem>
					<MenuItem
						isDestructive
						onClick={ () => {
							handleDeleteDemoSite();
							onClose();
						} }
					>
						<span>{ __( 'Delete' ) }</span>
					</MenuItem>
				</MenuGroup>
			) }
		</DropdownMenu>
	);
}
