import { DropdownMenu, Icon, MenuGroup, MenuItem, Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { moreVertical, trash } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import offlineIcon from 'src/components/offline-icon';
import ProgressBar from 'src/components/progress-bar';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { useGetSnapshotUsage } from 'src/stores/wpcom-api';

export const SnapshotInfo = ( {
	siteCount,
	siteLimit,
	isDisabled,
	onRemoveSnapshots,
	isDeleting = false,
}: {
	siteCount: number;
	siteLimit: number;
	isDisabled?: boolean;
	onRemoveSnapshots: () => void;
	isDeleting?: boolean;
} ) => {
	const { __ } = useI18n();
	const { data: snapshotUsage } = useGetSnapshotUsage( undefined, {
		refetchOnMountOrArgChange: true,
	} );
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const menuItemStyles = cx(
		'[&_span]:min-w-0 [&_span]:p-[1px]',
		isDisabled &&
			'[&.components-button:disabled]:cursor-not-allowed [&.components-button]:aria-disabled:cursor-not-allowed'
	);
	const isOffline = useOffline();
	const offlineMessage = __( 'Deleting preview sites requires an internet connection.' );
	return (
		<div className={ cx( 'flex flex-col', ! snapshotCreationBlocked && 'gap-3' ) }>
			<h2 className="a8c-label-semibold">{ __( 'Preview sites' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				{ snapshotCreationBlocked ? (
					<div className="text-frame-text-secondary">
						{ __( 'Preview sites are not available for your account.' ) }
					</div>
				) : (
					<>
						<div className="flex w-full flex-col gap-2">
							<div className="flex w-full flex-row justify-between gap-8">
								<div className="flex flex-row items-center text-right">
									{ isDeleting && <Spinner className="!mt-0 !mx-2" /> }
									<span className="text-frame-text-secondary">
										{ sprintf( __( '%1$d of %2$d active preview sites' ), siteCount, siteLimit ) }
									</span>
								</div>
							</div>
							<ProgressBar value={ siteCount } maxValue={ siteLimit } />
						</div>
						<DropdownMenu
							className={
								'ml-auto flex items-center [&_button:first-child]:p-0 [&_button:first-child]:min-w-6 [&_button:first-child]:h-6'
							}
							popoverProps={ { position: 'bottom left', resize: true } }
							icon={ <Icon icon={ moreVertical }></Icon> }
							size={ 24 }
							label={ __( 'More options' ) }
						>
							{ ( { onClose }: { onClose: () => void } ) => {
								return (
									<MenuGroup>
										<Tooltip
											disabled={ ! isOffline }
											icon={ offlineIcon }
											text={ offlineMessage }
											placement="bottom"
										>
											<MenuItem
												aria-description={ isOffline ? offlineMessage : '' }
												/**
												 * Because there is a single menu item, the `aria-disabled`
												 * attribute is used rather than `disabled` so that screen
												 * readers can focus the item to announce its disabled state.
												 * Otherwise, dropdown toggle would toggle an empty menu.
												 */
												aria-disabled={ isDisabled }
												icon={ trash }
												iconPosition="left"
												isDestructive
												className={ menuItemStyles }
												onClick={ () => {
													if ( isDisabled ) {
														return;
													}

													onRemoveSnapshots();
													onClose();
												} }
											>
												{ __( 'Delete all preview sites' ) }
											</MenuItem>
										</Tooltip>
									</MenuGroup>
								);
							} }
						</DropdownMenu>
					</>
				) }
			</div>
		</div>
	);
};
