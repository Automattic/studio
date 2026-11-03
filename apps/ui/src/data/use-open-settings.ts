import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { setProviderIntent } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import type { SettingsSectionId } from '@/data/settings-sections';

// Opens the settings dialog over the current screen, focusing the control of
// the setting titled `focus` when given.
export function useOpenSettings() {
	const navigate = useNavigate();
	const connector = useConnector();
	return useCallback(
		(
			section: SettingsSectionId = 'general',
			siteId?: string,
			focus?: string,
			accountIntent?: { intent: 'build' | 'annotate'; scope?: string }
		) => {
			setProviderIntent( connector, section === 'ai' ? accountIntent : undefined );
			void navigate( {
				to: '.',
				state: true,
				search: ( previous: Record< string, unknown > ) => ( {
					...previous,
					settings: section,
					settingsSite: siteId,
					settingsFocus: focus,
				} ),
			} );
		},
		[ navigate, connector ]
	);
}
