/**
 * <AddonSettingsPanels /> — Renders tab panels for addon-registered settings.
 * Rendered at the end of the UserSettings modal's TabPanel content.
 */
import { useEnabledAddons } from 'src/modules/addons/enabled-addons-context';
import type { AddonSettingsPanel } from 'src/modules/addons/addon-api';

interface AddonSettingsPanelsProps {
	activeTabName: string;
}

export function AddonSettingsPanels( { activeTabName }: AddonSettingsPanelsProps ) {
	const panels = useEnabledAddons().flatMap( ( addon ) => addon.settingsPanels ?? [] );

	if ( panels.length === 0 ) {
		return null;
	}

	return (
		<>
			{ panels.map( ( panel: AddonSettingsPanel ) =>
				activeTabName === panel.name ? <panel.component key={ panel.name } /> : null
			) }
		</>
	);
}

/**
 * Returns the tab definitions for all enabled addon settings panels,
 * suitable for merging into the UserSettings TabPanel tabs array.
 */
export function useAddonSettingsTabs(): Array< { name: string; title: string } > {
	return useEnabledAddons().flatMap( ( addon ) =>
		( addon.settingsPanels ?? [] ).map( ( panel: AddonSettingsPanel ) => ( {
			name: panel.name,
			title: panel.title,
		} ) )
	);
}
