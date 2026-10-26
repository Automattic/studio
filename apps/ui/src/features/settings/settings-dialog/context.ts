import { createContext, useContext } from 'react';

export type SiteSettingsSectionId = 'site' | 'php' | 'debugging';

// Lets the site form put its Discard and Save buttons in the dialog header,
// and hold the dialog open while it has unsaved changes. `settle` runs the
// exit the user attempted, once the changes are saved or discarded.
export const SettingsDialogContext = createContext< {
	actions: HTMLElement | null;
	setDirty: ( dirty: boolean ) => void;
	settle: () => void;
} >( { actions: null, setDirty: () => {}, settle: () => {} } );

export function useSettingsDialog() {
	return useContext( SettingsDialogContext );
}

// Set around Studio settings, whose titled rows offer a copy-link button.
export const SettingsLinkContext = createContext( false );
