/**
 * <AddonSettingsPanels /> — Renders tab panels for addon-registered settings.
 * Rendered at the end of the UserSettings modal's TabPanel content.
 */
import { getBundledAddons } from 'src/modules/addons/registry';
import type { AddonSettingsPanel } from 'src/modules/addons/addon-api';

interface AddonSettingsPanelsProps {
	activeTabName: string;
}

export function AddonSettingsPanels( { activeTabName }: AddonSettingsPanelsProps ) {
	const panels = getBundledAddons().flatMap( ( addon ) => addon.settingsPanels ?? [] );

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
 * Returns the tab definitions for all addon settings panels,
 * suitable for merging into the UserSettings TabPanel tabs array.
 */
export function getAddonSettingsTabs(): Array< { name: string; title: string } > {
	return getBundledAddons().flatMap( ( addon ) =>
		( addon.settingsPanels ?? [] ).map( ( panel: AddonSettingsPanel ) => ( {
			name: panel.name,
			title: panel.title,
		} ) )
	);
}
