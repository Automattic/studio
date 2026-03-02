/**
 * EnabledAddonsContext — reactive enabled-addon state.
 *
 * Seeded at boot from the persisted enabledAddonIds (via initEnabledAddons).
 * Consumers use useEnabledAddons() to get the filtered addon list;
 * the Add-ons settings tab uses useEnabledAddonIds() + setEnabledAddonIds()
 * to read/write the toggle state, which re-renders all consumers immediately.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { BUNDLED_ADDONS, getInitialEnabledAddonIds } from 'src/modules/addons/registry';
import type { ReactNode } from 'react';
import type { AddonDefinition } from 'src/modules/addons/addon-api';

interface EnabledAddonsContextValue {
	enabledIds: string[];
	setEnabledIds: ( ids: string[] ) => void;
	enabledAddons: AddonDefinition[];
}

const EnabledAddonsContext = createContext< EnabledAddonsContextValue | null >( null );

export function EnabledAddonsProvider( { children }: { children: ReactNode } ) {
	const [ enabledIds, setEnabledIdsState ] = useState< string[] >( getInitialEnabledAddonIds );

	const setEnabledIds = useCallback( ( ids: string[] ) => {
		setEnabledIdsState( ids );
		void getIpcApi().saveEnabledAddonIds( ids );
	}, [] );

	const enabledAddons = useMemo(
		() => BUNDLED_ADDONS.filter( ( addon ) => enabledIds.includes( addon.manifest.id ) ),
		[ enabledIds ]
	);

	return (
		<EnabledAddonsContext.Provider value={ { enabledIds, setEnabledIds, enabledAddons } }>
			{ children }
		</EnabledAddonsContext.Provider>
	);
}

export function useEnabledAddons(): AddonDefinition[] {
	const ctx = useContext( EnabledAddonsContext );
	// Outside the provider (tests, storybook) fall back to all bundled addons
	return ctx?.enabledAddons ?? BUNDLED_ADDONS;
}

export function useEnabledAddonIds(): [ string[], ( ids: string[] ) => void ] {
	const ctx = useContext( EnabledAddonsContext );
	if ( ! ctx ) {
		throw new Error( 'useEnabledAddonIds must be used inside EnabledAddonsProvider' );
	}
	return [ ctx.enabledIds, ctx.setEnabledIds ];
}
