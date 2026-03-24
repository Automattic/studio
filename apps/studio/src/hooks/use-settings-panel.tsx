import { createContext, useCallback, useContext, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { UserSettingsTabName } from 'src/modules/user-settings/user-settings-types';

interface SettingsPanelContext {
	isSettingsOpen: boolean;
	settingsTab: UserSettingsTabName;
	openSettings: ( tab?: UserSettingsTabName ) => void;
	closeSettings: () => void;
}

const Context = createContext< SettingsPanelContext >( {
	isSettingsOpen: false,
	settingsTab: 'general',
	openSettings: () => {},
	closeSettings: () => {},
} );

export function SettingsPanelProvider( { children }: { children: React.ReactNode } ) {
	const [ isSettingsOpen, setIsSettingsOpen ] = useState( false );
	const [ settingsTab, setSettingsTab ] = useState< UserSettingsTabName >( 'general' );

	const openSettings = useCallback( ( tab?: UserSettingsTabName ) => {
		setSettingsTab( tab ?? 'general' );
		setIsSettingsOpen( true );
	}, [] );

	const closeSettings = useCallback( () => {
		setIsSettingsOpen( false );
		setSettingsTab( 'general' );
	}, [] );

	useIpcListener( 'user-settings', ( _event, { tabName } ) => {
		if ( isSettingsOpen ) {
			closeSettings();
		} else {
			openSettings( tabName as UserSettingsTabName | undefined );
		}
	} );

	return (
		<Context.Provider value={ { isSettingsOpen, settingsTab, openSettings, closeSettings } }>
			{ children }
		</Context.Provider>
	);
}

export function useSettingsPanel() {
	return useContext( Context );
}
