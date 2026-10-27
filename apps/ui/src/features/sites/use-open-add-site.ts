import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

export type AddSiteSection = 'create' | 'connect' | 'import';

export function isAddSiteSection( value: unknown ): value is AddSiteSection {
	return value === 'create' || value === 'connect' || value === 'import';
}

// Opens the Add site dialog over the current screen. `pin` pins the new site.
export function useOpenAddSite() {
	const navigate = useNavigate();
	return useCallback(
		( section: AddSiteSection = 'create', { pin = false } = {} ) =>
			void navigate( {
				to: '.',
				search: ( previous: Record< string, unknown > ) => ( {
					...previous,
					addSite: section,
					pin: pin || undefined,
				} ),
			} ),
		[ navigate ]
	);
}
