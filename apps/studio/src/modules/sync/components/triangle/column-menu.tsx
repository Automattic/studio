import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';

export function ColumnMenu( props: {
	onReplace?: () => void;
	onDisconnect: () => void;
	hasArchivedCandidates: boolean;
} ) {
	return (
		<DropdownMenu icon={ moreVertical } label={ __( 'Column options' ) }>
			{ ( { onClose }: { onClose: () => void } ) => (
				<MenuGroup>
					{ props.hasArchivedCandidates && props.onReplace && (
						<MenuItem
							onClick={ () => {
								props.onReplace!();
								onClose();
							} }
						>
							{ __( 'Replace with another connected site' ) }
						</MenuItem>
					) }
					<MenuItem
						isDestructive
						onClick={ () => {
							props.onDisconnect();
							onClose();
						} }
					>
						{ __( 'Disconnect' ) }
					</MenuItem>
				</MenuGroup>
			) }
		</DropdownMenu>
	);
}
