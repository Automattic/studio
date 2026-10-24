import { useNavigate } from '@tanstack/react-router';
import type { SettingsSectionId } from '@/features/settings/settings-dialog';

// Opens the settings dialog over the current screen, focusing the control of
// the setting titled `focus` when given.
export function useOpenSettings() {
	const navigate = useNavigate();
	return ( section: SettingsSectionId = 'general', siteId?: string, focus?: string ) =>
		void navigate( {
			to: '.',
			search: ( previous: Record< string, unknown > ) => ( {
				...previous,
				settings: section,
				settingsSite: siteId,
				settingsFocus: focus,
			} ),
		} );
}
