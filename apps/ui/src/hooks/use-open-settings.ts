import { useNavigate } from '@tanstack/react-router';
import type { SettingsSectionId } from '@/components/settings-dialog';

// Opens the settings dialog over the current screen.
export function useOpenSettings() {
	const navigate = useNavigate();
	return ( section: SettingsSectionId = 'general', siteId?: string ) =>
		void navigate( {
			to: '.',
			search: ( previous: Record< string, unknown > ) => ( {
				...previous,
				settings: section,
				settingsSite: siteId,
			} ),
		} );
}
