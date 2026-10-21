import { createContext, useContext } from 'react';

export type SiteSettingsSectionId = 'site' | 'php' | 'debugging';

// Lets the site form put its Discard and Save buttons in the dialog header,
// and hold the dialog open while it has unsaved changes.
export const SettingsDialogContext = createContext< {
	actions: HTMLElement | null;
	setDirty: ( dirty: boolean ) => void;
} >( { actions: null, setDirty: () => {} } );

export function useSettingsDialog() {
	return useContext( SettingsDialogContext );
}
