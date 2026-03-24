import { Icon, cog, people, tool, close as closeIcon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { useSettingsPanel } from 'src/hooks/use-settings-panel';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { McpSettings } from 'src/modules/mcp/components/mcp-settings';
import { AccountTab } from 'src/modules/user-settings/components/account-tab';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';
import { SkillsTab } from 'src/modules/user-settings/components/skills-tab';
import { UserSettingsTabName } from 'src/modules/user-settings/user-settings-types';
import { useRootSelector } from 'src/stores';
import { snapshotSelectors } from 'src/stores/snapshot-slice';
import { useDeleteAllSnapshots, useGetSnapshotUsage } from 'src/stores/wpcom-api';

interface NavItem {
	name: UserSettingsTabName;
	label: string;
	icon: JSX.Element;
}

export function SettingsPanel() {
	const { __ } = useI18n();
	const { enableAgentSuite } = useFeatureFlags();
	const { settingsTab, closeSettings, openSettings } = useSettingsPanel();
	const { user } = useAuth();
	const isOffline = useOffline();

	const snapshotsByUser = useRootSelector( ( state ) =>
		snapshotSelectors.selectSnapshotsByUser( state, user?.id ?? 0 )
	);
	const snapshotQuota = useRootSelector( ( state ) => state.snapshot.snapshotQuota );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useGetSnapshotUsage();
	const definitiveSnapshotCount = snapshotUsage?.siteCount ?? snapshotsByUser?.length ?? 0;
	const [ deleteAllSnapshots, { isLoading: isDeletingAllSnapshots } ] = useDeleteAllSnapshots();

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

	const navItems: NavItem[] = useMemo( () => {
		const items: NavItem[] = [ { name: 'general', label: __( 'General' ), icon: cog } ];
		if ( enableAgentSuite ) {
			items.push( { name: 'skills', label: __( 'Skills' ), icon: tool } );
		}
		items.push( { name: 'account', label: __( 'Account' ), icon: people } );
		if ( enableAgentSuite ) {
			items.push( { name: 'mcp', label: __( 'MCP' ), icon: tool } );
		}
		return items;
	}, [ __, enableAgentSuite ] );

	// Escape key closes settings
	useEffect( () => {
		const onKeyDown = ( e: KeyboardEvent ) => {
			if ( e.key === 'Escape' ) {
				closeSettings();
			}
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ closeSettings ] );

	return (
		<div className="absolute inset-0 z-0 flex items-start justify-center text-chrome-fg [&_svg]:fill-current app-no-drag-region overflow-y-auto pt-10 pb-3">
			<div className="flex gap-8 w-full max-w-[840px] px-6">
				{ /* Left nav */ }
				<nav className="w-[160px] flex-shrink-0 flex flex-col gap-1 sticky top-0">
					<button
						onClick={ closeSettings }
						className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors text-chrome-fg-muted hover:text-chrome-fg hover:bg-chrome-hover mb-2"
					>
						<Icon icon={ closeIcon } size={ 20 } />
						{ __( 'Close' ) }
					</button>
					{ navItems.map( ( item ) => (
						<button
							key={ item.name }
							onClick={ () => openSettings( item.name ) }
							className={ cx(
								'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors',
								settingsTab === item.name
									? 'bg-chrome-active text-chrome-fg'
									: 'text-chrome-fg-muted hover:text-chrome-fg hover:bg-chrome-hover'
							) }
						>
							<Icon icon={ item.icon } size={ 20 } />
							{ item.label }
						</button>
					) ) }
				</nav>

				{ /* Content area */ }
				<div className="flex-1 min-w-0 settings-chrome-surface flex gap-4 flex-col">
					{ settingsTab === 'general' && <PreferencesTab onClose={ closeSettings } /> }
					{ settingsTab === 'skills' && <SkillsTab /> }
					{ settingsTab === 'mcp' && <McpSettings /> }
					{ settingsTab === 'account' && (
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
			</div>
		</div>
	);
}
