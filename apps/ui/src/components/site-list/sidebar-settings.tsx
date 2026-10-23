import { __ } from '@wordpress/i18n';
import { SettingsRow, SettingsToggle } from '@/components/settings-view/rows';
import { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';

export const getSidebarSettingTitles = () => [
	__( 'Show recent chats' ),
	__( 'Collapse sidebar groups' ),
];

/** The sidebar's rows in Settings ▸ Interface. */
export function SidebarSettings() {
	const { showRecentChats, autoCollapseSites, save } = useSidebarPreferences();
	const [ recentTitle, collapseTitle ] = getSidebarSettingTitles();
	return (
		<>
			<SettingsRow title={ recentTitle } description={ __( 'Show recent chats in the sidebar.' ) }>
				<SettingsToggle
					label={ recentTitle }
					checked={ showRecentChats }
					onChange={ ( next ) => save( { showRecentChats: next } ) }
				/>
			</SettingsRow>
			<SettingsRow
				title={ collapseTitle }
				description={ __( 'Opening each site closes all others.' ) }
			>
				<SettingsToggle
					label={ collapseTitle }
					checked={ autoCollapseSites }
					onChange={ ( next ) => save( { autoCollapseSites: next } ) }
				/>
			</SettingsRow>
		</>
	);
}
