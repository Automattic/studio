import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Modal from 'src/components/modal';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	AddonSettingsPanels,
	useAddonSettingsTabs,
} from 'src/modules/addons/addon-settings-panels';
import { AccountTab } from 'src/modules/user-settings/components/account-tab';
import { AddonsTab } from 'src/modules/user-settings/components/addons-tab';
import { NonAuthenticatedAccountTab } from 'src/modules/user-settings/components/non-authenticated-account-tab';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';
import { UsageTab } from 'src/modules/user-settings/components/usage-tab';
import { UserSettingsTab } from 'src/modules/user-settings/user-settings-types';
import { useRootSelector } from 'src/stores';
import { snapshotSelectors } from 'src/stores/snapshot-slice';
import { useDeleteAllSnapshots, useGetSnapshotUsage } from 'src/stores/wpcom-api';

export default function UserSettings() {
	const { __ } = useI18n();
	const { isAuthenticated, logout, user } = useAuth();
	const snapshotsByUser = useRootSelector( ( state ) =>
		snapshotSelectors.selectSnapshotsByUser( state, user?.id ?? 0 )
	);
	const snapshotQuota = useRootSelector( ( state ) => state.snapshot.snapshotQuota );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useGetSnapshotUsage();
	const definitiveSnapshotCount = snapshotUsage?.siteCount ?? snapshotsByUser?.length ?? 0;

	const [ needsToOpenUserSettings, setNeedsToOpenUserSettings ] = useState( false );
	const [ selectedTabName, setSelectedTabName ] = useState< string | undefined >();

	const [ deleteAllSnapshots, { isLoading: isDeletingAllSnapshots } ] = useDeleteAllSnapshots();

	const isOffline = useOffline();

	const resetLocalState = useCallback( () => {
		setNeedsToOpenUserSettings( false );
		setSelectedTabName( undefined );
	}, [] );

	useIpcListener( 'user-settings', ( _event, { tabName } ) => {
		setSelectedTabName( tabName );
		setNeedsToOpenUserSettings( ! needsToOpenUserSettings );
	} );

	const onRemoveSnapshots = useCallback( async () => {
		const CANCEL_BUTTON_INDEX = 0;
		const DELETE_BUTTON_INDEX = 1;

		const { response } = await getIpcApi().showMessageBox( {
			type: 'warning',
			message: __( 'Delete all preview sites' ),
			detail: __(
				'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
			),
			buttons: [ __( 'Cancel' ), __( 'Delete all' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === DELETE_BUTTON_INDEX ) {
			try {
				await deleteAllSnapshots().unwrap();
				await getIpcApi().saveSnapshotsToStorage( [] );
			} catch ( error ) {
				await getIpcApi().showMessageBox( {
					type: 'warning',
					message: __( 'Failed to delete all preview sites' ),
					detail: __( 'An error occurred while deleting all preview sites. Please try again.' ),
					buttons: [ __( 'OK' ) ],
				} );
			}
		}
	}, [ __, deleteAllSnapshots ] );

	const tabs: UserSettingsTab[] = [
		{
			name: 'account',
			title: __( 'Account' ),
		},
		{
			name: 'preferences',
			title: __( 'Preferences' ),
		},
	];

	if ( isAuthenticated ) {
		tabs.push( {
			name: 'usage',
			title: __( 'Usage' ),
		} );
	}

	tabs.push( {
		name: 'addons',
		title: __( 'Add-ons' ),
	} );

	// Append addon settings tabs
	const addonSettingsTabs = useAddonSettingsTabs();
	for ( const addonTab of addonSettingsTabs ) {
		tabs.push( addonTab );
	}

	return (
		<>
			{ needsToOpenUserSettings && (
				<Modal
					title={ __( 'Settings' ) }
					isDismissible
					onRequestClose={ resetLocalState }
					size="medium"
					className={ cx( 'min-h-[350px]', '[&_[role="document"]]:px-0', 'app-no-drag-region' ) }
				>
					<TabPanel
						className="w-full"
						tabs={ tabs }
						orientation="horizontal"
						initialTabName={ selectedTabName }
						onSelect={ ( tabName ) => {
							setSelectedTabName( tabName );
						} }
					>
						{ ( { name } ) => (
							<div className="mt-6 px-8 flex gap-4 flex-col">
								{ name === 'account' &&
									( isAuthenticated ? (
										<AccountTab user={ user } logout={ logout } />
									) : (
										<NonAuthenticatedAccountTab />
									) ) }
								{ name === 'preferences' && <PreferencesTab onClose={ resetLocalState } /> }
								{ name === 'addons' && <AddonsTab /> }
								{ name === 'usage' && isAuthenticated && (
									<UsageTab
										loadingDeletingAllSnapshots={ isDeletingAllSnapshots }
										activeSnapshotCount={ definitiveSnapshotCount }
										isLoadingSnapshotUsage={ isLoadingSnapshotUsage }
										isOffline={ isOffline }
										snapshotQuota={ snapshotQuota }
										onRemoveSnapshots={ onRemoveSnapshots }
									/>
								) }
								<AddonSettingsPanels activeTabName={ name } />
							</div>
						) }
					</TabPanel>
				</Modal>
			) }
		</>
	);
}
