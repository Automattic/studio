import { DropdownMenu, Icon, MenuGroup, MenuItem, Spinner } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { moreVertical, trash } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState, useEffect } from 'react';
import { LIMIT_OF_PROMPTS_PER_USER, WPCOM_PROFILE_URL } from '../constants';
import { useAuth } from '../hooks/use-auth';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useOffline } from '../hooks/use-offline';
import { usePromptUsage } from '../hooks/use-prompt-usage';
import { useSnapshots } from '../hooks/use-snapshots';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { Gravatar } from './gravatar';
import { LanguagePicker } from './language-picker';
import Modal from './modal';
import offlineIcon from './offline-icon';
import ProgressBar from './progress-bar';
import Tooltip from './tooltip';
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
				<Button
					onClick={ () => getIpcApi().openURL( WPCOM_PROFILE_URL ) }
					aria-label={ __( 'Profile link' ) }
					className="py-0 px-0"
				>
					<Gravatar detailedDefaultImage size={ 32 } isBlack />
				</Button>
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

	const { snapshotCreationBlocked } = useSnapshots();
	const menuItemStyles = cx(
		'[&_span]:min-w-0 [&_span]:p-[1px]',
		isDisabled &&
			'[&.components-button:disabled]:cursor-not-allowed [&.components-button]:aria-disabled:cursor-not-allowed'
	);
	const isOffline = useOffline();
	const offlineMessage = __( 'Deleting demo sites requires an internet connection.' );
	return (
		<div className={ cx( 'flex flex-col', ! snapshotCreationBlocked && 'gap-3' ) }>
			<h2 className="a8c-label-semibold">{ __( 'Demo sites' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				{ snapshotCreationBlocked ? (
					<div className="text-a8c-gray-70">
						{ __( 'Demo sites are not available for your account.' ) }
					</div>
				) : (
					<>
						<div className="flex w-full flex-col gap-2">
							<div className="flex w-full flex-row justify-between gap-8">
								<div className="flex flex-row items-center text-right">
									{ isDeleting && <Spinner className="!mt-0 !mx-2" /> }
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
												{ __( 'Delete all demo sites' ) }
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
function PromptInfo() {
	const { __ } = useI18n();
	const { promptCount = 0, promptLimit = LIMIT_OF_PROMPTS_PER_USER } = usePromptUsage();

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold">{ __( 'AI assistant' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between gap-8 ">
						<div className="flex flex-row items-center text-right">
							<span className="text-a8c-gray-70">
								{ sprintf( __( '%1s of %2s monthly prompts used' ), promptCount, promptLimit ) }
							</span>
						</div>
					</div>
					<ProgressBar value={ promptCount } maxValue={ promptLimit } />
				</div>
				<div className="h-6 w-6"></div>
			</div>
		</div>
	);
}

export default function UserSettings() {
	const { __ } = useI18n();
	const [ deletedAllSnapshots, setDeletedAllSnapshots ] = useState( false );
	const { isAuthenticated, authenticate, logout, user } = useAuth();
	const {
		allSnapshots,
		activeSnapshotCount,
		snapshotQuota,
		isLoadingSnapshotUsage,
		loadingDeletingAllSnapshots,
		deleteAllSnapshots,
		loadingServerSnapshots: isLoadingAllSnapshots,
	} = useSnapshots();
	const [ needsToOpenUserSettings, setNeedsToOpenUserSettings ] = useState( false );

	const isOffline = useOffline();
	const offlineMessage = __( 'You’re currently offline.' );

	const resetLocalState = useCallback( () => {
		setNeedsToOpenUserSettings( false );
	}, [] );

	useIpcListener( 'user-settings', () => {
		setNeedsToOpenUserSettings( ! needsToOpenUserSettings );
	} );

	useEffect( () => {
		if ( deletedAllSnapshots && ! loadingDeletingAllSnapshots ) {
			setDeletedAllSnapshots( false );
			getIpcApi().showNotification( {
				title: __( 'Delete Successful' ),
				body: __( 'All demo sites have been deleted.' ),
			} );
		}
	}, [ __, loadingDeletingAllSnapshots, deletedAllSnapshots ] );

	const onRemoveSnapshots = useCallback( async () => {
		if ( ! allSnapshots || allSnapshots.length === 0 ) {
			return;
		}

		const CANCEL_BUTTON_INDEX = 0;
		const DELETE_BUTTON_INDEX = 1;

		const { response } = await getIpcApi().showMessageBox( {
			type: 'warning',
			message: __( 'Delete all demo sites' ),
			detail: __(
				'All demo sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
			),
			buttons: [ __( 'Cancel' ), __( 'Delete all' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === DELETE_BUTTON_INDEX ) {
			await deleteAllSnapshots( allSnapshots );
			setDeletedAllSnapshots( true );
		}
	}, [ allSnapshots, deleteAllSnapshots, __ ] );

	return (
		<>
			{ needsToOpenUserSettings && (
				<Modal title={ __( 'Settings' ) } isDismissible onRequestClose={ resetLocalState }>
					{ ! isAuthenticated && (
						<div className="flex flex-col gap-6">
							<div className="justify-between items-center w-full h-auto flex">
								<WordPressLogo width={ 110 } />
								<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
									<Button
										aria-description={ isOffline ? offlineMessage : '' }
										aria-disabled={ isOffline }
										variant="primary"
										onClick={ () => {
											if ( isOffline ) {
												return;
											}
											authenticate();
										} }
									>
										{ __( 'Log in' ) }
									</Button>
								</Tooltip>
							</div>
							<div className="border border-[#F0F0F0] w-full"></div>
							<LanguagePicker />
						</div>
					) }
					{ isAuthenticated && (
						<div className="gap-6 flex flex-col">
							<UserInfo onLogout={ logout } user={ user } />
							<div className="border border-[#F0F0F0] w-full"></div>
							<div className="flex flex-col gap-6">
								<LanguagePicker />
								<SnapshotInfo
									isDeleting={ loadingDeletingAllSnapshots }
									isDisabled={
										activeSnapshotCount === 0 ||
										loadingDeletingAllSnapshots ||
										isLoadingAllSnapshots ||
										isLoadingSnapshotUsage ||
										allSnapshots?.length === 0 ||
										isOffline
									}
									siteCount={ activeSnapshotCount }
									siteLimit={ snapshotQuota }
									onRemoveSnapshots={ onRemoveSnapshots }
								/>
								<PromptInfo />
							</div>
						</div>
					) }
				</Modal>
			) }
		</>
	);
}
