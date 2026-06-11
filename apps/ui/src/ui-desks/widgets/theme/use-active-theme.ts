import { store as coreDataStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { selectActiveTheme, type CoreDataThemeSelectors } from './api';

export function useActiveTheme( isEnabled = true ) {
	return useSelect(
		( select ) => {
			if ( ! isEnabled ) {
				return null;
			}

			return selectActiveTheme( select( coreDataStore ) as unknown as CoreDataThemeSelectors );
		},
		[ isEnabled ]
	);
}
