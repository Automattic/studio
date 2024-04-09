import { DropdownMenu, Icon, MenuGroup, MenuItem, Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { moreVertical, trash } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useDeleteSnapshot } from '../hooks/use-delete-snapshot';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useSiteDetails } from '../hooks/use-site-details';
import { useSiteUsage } from '../hooks/use-site-usage';
import { cx } from '../lib/cx';
import Button from './button';
import { Gravatar } from './gravatar';
import Modal from './modal';
import ProgressBar from './progress-bar';
import { WordPressLogo } from './wordpress-logo';

const UserInfo = ( {
	user,
	onLogout,
}: {
	user?: { displayName: string; email: string };
	onLogout: () => void;
} ) => {
	const { __ } = useI18n();
	return (
		<div className="flex w-full gap-5">
			<div className="flex w-full items-center gap-[15px]">
				<Gravatar isLarge={ true } isBlack />
				<div className="flex flex-col">
					<span className="overflow-ellipsis">{ user?.displayName }</span>
					<span className="text-[#757575] text-[10px] leading-[10px]">{ user?.email }</span>
				</div>
			</div>
			<Button variant="secondary" className="!gap-3" onClick={ onLogout }>
				{ __( 'Log out' ) }
			</Button>
		</div>
	);
};

const SnapshotInfo = ( {
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
	const menuItemStyles = cx(
		'[&_span]:min-w-0 [&_span]:p-[1px] cursor-pointer',
		isDisabled &&
			'[&_.components-button:disabled]:cursor-not-allowed [&_.components-button]aria-disabled:cursor-not-allowed'
	);
	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Usage' ) }</h2>
			<div className="flex gap-4 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between">
						<span>{ __( 'Demo sites' ) }</span>

						<div className="flex flex-row items-center">
							{ isDeleting && <Spinner className="!mt-0 !ml-0 !mr-2" /> }
							<span className="text-a8c-gray-70">
								{ sprintf( __( '%1s of %2s active demo sites' ), siteCount, siteLimit ) }
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
					icon={ <Icon className="cursor-pointer" icon={ moreVertical }></Icon> }
					size={ 24 }
					label={ __( 'More options' ) }
				>
					{ ( { onClose }: { onClose: () => void } ) => {
						return (
							<MenuGroup>
								<MenuItem
									/**
									 * Because there is a single menu item, the `aria-disabled`
									 * attribute is used rather than `disabled` so that screen
									 * readers can focus the item to announce its disabled state.
									 * Otherwise, dropdown toggle would toggle an empty menu.
									 */
									aria-disabled={ isDisabled }
									iconPosition="right"
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
									<Icon className="mr-2" icon={ trash } /> { __( 'Delete all demo sites' ) }
								</MenuItem>
							</MenuGroup>
						);
					} }
				</DropdownMenu>
			</div>
		</div>
	);
};

export default function UserSettings() {
	const { __ } = useI18n();
	const { isAuthenticated, authenticate, logout, user } = useAuth();
	const { snapshots } = useSiteDetails();
	const { siteLimit, siteCount, isLoading: isLoadingSiteUsage } = useSiteUsage();
	const { deleteAllSnapshots, loadingDeletingAllSnapshots } = useDeleteSnapshot( {
		displayAlert: true,
	} );
	const [ needsToOpenUserSettings, setNeedsToOpenUserSettings ] = useState( false );

	const resetLocalState = useCallback( () => {
		setNeedsToOpenUserSettings( false );
	}, [] );

	useIpcListener( 'user-settings', () => {
		setNeedsToOpenUserSettings( ! needsToOpenUserSettings );
	} );

	const onRemoveSnapshots = useCallback( async () => {
		if ( snapshots?.length === 0 ) {
			return;
		}
		await deleteAllSnapshots( snapshots );
	}, [ snapshots, deleteAllSnapshots ] );

	return (
		<>
			{ needsToOpenUserSettings && (
				<Modal
					className="w-[400px]"
					title={ __( 'Settings' ) }
					isDismissible
					onRequestClose={ resetLocalState }
				>
					{ ! isAuthenticated && (
						<div className="justify-between items-center w-full h-auto flex">
							<WordPressLogo width={ 110 } />
							<Button variant="primary" onClick={ authenticate }>
								{ __( 'Log in' ) }
							</Button>
						</div>
					) }
					{ isAuthenticated && (
						<div className="gap-6 flex flex-col">
							<UserInfo onLogout={ logout } user={ user } />
							<div className="border border-[#F0F0F0] w-full"></div>
							<SnapshotInfo
								isDeleting={ loadingDeletingAllSnapshots }
								isDisabled={
									siteCount === 0 ||
									loadingDeletingAllSnapshots ||
									isLoadingSiteUsage ||
									snapshots.length === 0
								}
								siteCount={ siteCount }
								siteLimit={ siteLimit }
								onRemoveSnapshots={ onRemoveSnapshots }
							/>
						</div>
					) }
				</Modal>
			) }
		</>
	);
}
