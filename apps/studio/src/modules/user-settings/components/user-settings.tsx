import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import Modal from 'src/components/modal';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { McpSettings } from 'src/modules/mcp/components/mcp-settings';
import { AccountTab } from 'src/modules/user-settings/components/account-tab';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';
import { SkillsTab } from 'src/modules/user-settings/components/skills-tab';
import { StudioCodeTab } from 'src/modules/user-settings/components/studio-code-tab';
import { UserSettingsTab } from 'src/modules/user-settings/user-settings-types';
import { useRootSelector } from 'src/stores';
import { snapshotSelectors } from 'src/stores/snapshot-slice';
import { useDeleteAllSnapshots, useGetSnapshotUsage } from 'src/stores/wpcom-api';

export default function UserSettings() {
	const { __ } = useI18n();
	const { user } = useAuth();
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

	const tabs = useMemo( () => {
		const result: UserSettingsTab[] = [
			{
				name: 'general',
				title: __( 'General' ),
			},
		];

		result.push( {
			name: 'account',
			title: __( 'Account' ),
		} );

		result.push( {
			name: 'studio-code',
			title: __( 'Studio Code' ),
		} );

		result.push( {
			name: 'skills',
			title: __( 'Skills' ),
		} );

		result.push( {
			name: 'mcp',
			title: __( 'MCP' ),
		} );

		return result;
	}, [ __ ] );

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
							<div className="mt-6 px-8 pb-8 flex gap-4 flex-col">
								{ name === 'general' && <PreferencesTab onClose={ resetLocalState } /> }
								{ name === 'studio-code' && <StudioCodeTab /> }
								{ name === 'skills' && <SkillsTab /> }
								{ name === 'mcp' && <McpSettings /> }
								{ name === 'account' && (
									<AccountTab
										loadingDeletingAllSnapshots={ isDeletingAllSnapshots }
										activeSnapshotCount={ definitiveSnapshotCount }
										isLoadingSnapshotUsage={ isLoadingSnapshotUsage }
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
