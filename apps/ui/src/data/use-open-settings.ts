import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { SettingsSectionId } from '@/data/settings-sections';

// Opens the settings dialog over the current screen, focusing the control of
// the setting titled `focus` when given.
export function useOpenSettings() {
	const navigate = useNavigate();
	return useCallback(
		( section: SettingsSectionId = 'general', siteId?: string, focus?: string ) =>
			void navigate( {
				to: '.',
				state: true,
				search: ( previous: Record< string, unknown > ) => ( {
					...previous,
					settings: section,
					settingsSite: siteId,
					settingsFocus: focus,
				} ),
			} ),
		[ navigate ]
	);
}
