import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useConfirmationDialog } from 'src/hooks/use-confirmation-dialog';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useUpdateDemoSite } from 'src/hooks/use-update-demo-site';

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

	const showUpdatePreviewConfirmation = useConfirmationDialog( {
		localStorageKey: 'dontShowUpdateWarning',
		message: __( 'Overwrite preview' ),
		detail: __(
			"Updating will replace the existing files and database with a copy from your local site. Any changes you've made to your preview site will be permanently lost."
		),
		confirmButtonLabel: __( 'Update' ),
	} );

	const handleUpdatePreviewSite = async () => {
		showUpdatePreviewConfirmation( () => {
			updateDemoSite( snapshot, selectedSite );
		} );
	};

	const showDeletePreviewConfirmation = useConfirmationDialog( {
		type: 'warning',
		message: __( 'Delete preview' ),
		detail: __(
			'Your previews files and database along with all posts, pages, comments and media will be lost.'
		),
		confirmButtonLabel: __( 'Delete' ),
	} );

	const handleDeletePreviewSite = async () => {
		showDeletePreviewConfirmation( () => {
			deleteSnapshot( snapshot );
		} );
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
							handleUpdatePreviewSite();
							onClose();
						} }
					>
						<span>{ __( 'Update' ) }</span>
					</MenuItem>
					<MenuItem
						isDestructive
						onClick={ () => {
							handleDeletePreviewSite();
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
