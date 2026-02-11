import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { Snapshot } from '@studio/common/types/snapshot';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip, TooltipProps } from 'src/components/tooltip';
import { useConfirmationDialog } from 'src/hooks/use-confirmation-dialog';
import { useOffline } from 'src/hooks/use-offline';
import { useAppDispatch } from 'src/stores';
import { snapshotActions, snapshotThunks } from 'src/stores/snapshot-slice';
import { RenamePreviewModal } from './rename-preview-modal';

interface PreviewActionButtonsMenuProps {
	snapshot: Snapshot;
	selectedSite: SiteDetails;
	disabledUpdate?: boolean;
	updateButtonTooltipContent?: Partial< TooltipProps & { text?: string } >;
	showUpdateTooltip?: boolean;
}

export function PreviewActionButtonsMenu( {
	snapshot,
	selectedSite,
	disabledUpdate,
	updateButtonTooltipContent = {},
	showUpdateTooltip = false,
}: PreviewActionButtonsMenuProps ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const isOffline = useOffline();
	const [ showRenameModal, setShowRenameModal ] = useState( false );

	const showUpdatePreviewConfirmation = useConfirmationDialog( {
		localStorageKey: 'dontShowUpdateWarning',
		message: __( 'Overwrite preview' ),
		detail: __(
			"Updating will replace the existing files and database with a copy from your local site. Any changes you've made to your preview site will be permanently lost."
		),
		confirmButtonLabel: __( 'Update' ),
	} );

	const handleUpdatePreviewSite = () => {
		void showUpdatePreviewConfirmation( () => {
			void dispatch(
				snapshotThunks.updateSnapshot( {
					atomicSiteId: snapshot.atomicSiteId,
					siteFolder: selectedSite.path,
				} )
			);
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

	const handleDeletePreviewSite = () => {
		void showDeletePreviewConfirmation( () => {
			void dispatch(
				snapshotThunks.deleteSnapshot( {
					hostname: snapshot.url,
				} )
			);
		} );
	};

	const handleRename = ( newName: string ) => {
		dispatch(
			snapshotActions.updateSnapshotLocally( {
				atomicSiteId: snapshot.atomicSiteId,
				snapshot: { name: newName },
			} )
		);

		setShowRenameModal( false );
	};

	return (
		<>
			<DropdownMenu
				icon={ moreVertical }
				label={ __( 'Preview actions' ) }
				className="p-1 flex items-center"
			>
				{ ( { onClose }: { onClose: () => void } ) => (
					<MenuGroup className="w-40 overflow-hidden">
						<MenuItem
							onClick={ () => {
								setShowRenameModal( true );
								onClose();
							} }
						>
							<span>{ __( 'Rename' ) }</span>
						</MenuItem>
						<MenuItem
							onClick={ () => {
								handleUpdatePreviewSite();
								onClose();
							} }
							disabled={ disabledUpdate }
						>
							<Tooltip
								disabled={ ! showUpdateTooltip }
								placement="top-start"
								{ ...updateButtonTooltipContent }
							>
								<span>{ __( 'Update' ) }</span>
							</Tooltip>
						</MenuItem>
						<MenuItem
							isDestructive
							disabled={ isOffline }
							onClick={ () => {
								handleDeletePreviewSite();
								onClose();
							} }
						>
							<Tooltip
								disabled={ ! isOffline }
								text={ __( 'Deleting a preview site requires an internet connection.' ) }
								icon={ offlineIcon }
								placement="top-start"
							>
								<span>{ __( 'Delete' ) }</span>
							</Tooltip>
						</MenuItem>
					</MenuGroup>
				) }
			</DropdownMenu>

			{ showRenameModal && (
				<RenamePreviewModal
					initialName={ snapshot.name || selectedSite.name }
					onRename={ handleRename }
					onClose={ () => setShowRenameModal( false ) }
				/>
			) }
		</>
	);
}
