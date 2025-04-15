import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState, useEffect } from 'react';
import { LanguagePicker } from 'src/components/language-picker';
import Modal from 'src/components/modal';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useI18nData } from 'src/hooks/use-i18n-data';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { AccountTab } from 'src/modules/user-settings/components/account-tab';
import { NonAuthenticatedAccountTab } from 'src/modules/user-settings/components/non-authenticated-account-tab';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';
import { PromptInfo } from 'src/modules/user-settings/components/prompt-info';
import { SnapshotInfo } from 'src/modules/user-settings/components/snapshot-info';
import { UsageTab } from 'src/modules/user-settings/components/usage-tab';

export default function UserSettings() {
	const { __ } = useI18n();
	const [ deletedAllSnapshots, setDeletedAllSnapshots ] = useState( false );
	const { isAuthenticated, authenticate, logout, user } = useAuth();
	const { preferredEditor } = useFeatureFlags();
	const { locale: savedLocale, setLocale: setSavedLocale } = useI18nData();
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
				body: __( 'All preview sites have been deleted.' ),
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
			message: __( 'Delete all preview sites' ),
			detail: __(
				'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
			),
			buttons: [ __( 'Cancel' ), __( 'Delete all' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === DELETE_BUTTON_INDEX ) {
			await deleteAllSnapshots( allSnapshots );
			setDeletedAllSnapshots( true );
		}
	}, [ allSnapshots, deleteAllSnapshots, __ ] );

	if ( ! preferredEditor ) {
		return (
			<>
				{ needsToOpenUserSettings && (
					<Modal title={ __( 'Settings' ) } isDismissible onRequestClose={ resetLocalState }>
						{ ! isAuthenticated && (
							<div className="flex flex-col gap-6">
								<NonAuthenticatedAccountTab />
								<div className="border-t border-[#F0F0F0] w-full"></div>
								<LanguagePicker value={ savedLocale } onChange={ setSavedLocale } />
							</div>
						) }
						{ isAuthenticated && (
							<div className="gap-6 flex flex-col">
								<AccountTab user={ user } logout={ logout } />
								<div className="border-t border-[#F0F0F0] w-full"></div>
								<div className="flex flex-col gap-6">
									<LanguagePicker value={ savedLocale } onChange={ setSavedLocale } />
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

	const tabs = [
		{
			name: 'account',
			title: __( 'Account' ),
		},
		{
			name: 'preferences',
			title: __( 'Preferences' ),
		},
		...( isAuthenticated
			? [
					{
						name: 'usage',
						title: __( 'Usage' ),
					},
			  ]
			: [] ),
	];

	return (
		<>
			{ needsToOpenUserSettings && (
				<Modal
					title={ __( 'Settings' ) }
					isDismissible
					onRequestClose={ resetLocalState }
					size="medium"
					className={ cx(
						'min-h-[350px]',
						'[&_[role="document"]]:px-0',
						'[&_[role="document"]]:mt-[64px]'
					) }
				>
					<TabPanel className="w-full" tabs={ tabs } orientation="horizontal">
						{ ( { name } ) => (
							<div className="mt-6 px-8 flex flex-col gap-6">
								{ name === 'account' &&
									( isAuthenticated ? (
										<AccountTab user={ user } logout={ logout } />
									) : (
										<NonAuthenticatedAccountTab />
									) ) }
								{ name === 'preferences' && <PreferencesTab onClose={ resetLocalState } /> }
								{ name === 'usage' && isAuthenticated && (
									<UsageTab
										loadingDeletingAllSnapshots={ loadingDeletingAllSnapshots }
										activeSnapshotCount={ activeSnapshotCount }
										isLoadingAllSnapshots={ isLoadingAllSnapshots }
										isLoadingSnapshotUsage={ isLoadingSnapshotUsage }
										allSnapshots={ allSnapshots }
										isOffline={ isOffline }
										snapshotQuota={ snapshotQuota }
										onRemoveSnapshots={ onRemoveSnapshots }
									/>
								) }
							</div>
						) }
					</TabPanel>
				</Modal>
			) }
		</>
	);
}
