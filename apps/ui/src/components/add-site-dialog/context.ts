import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface AddSiteContextValue {
	// Announces long work and locks the dialog until it's cleared.
	setProgress: Dispatch< SetStateAction< string | null > >;
	// Shows the progress the CLI publishes for this site in place of the panel's.
	followSite: ( siteId: string | undefined ) => void;
	// The header's action slot, for a panel's primary buttons.
	actions: HTMLElement | null;
	// Pins a site the dialog created when it was opened from the Pinned group.
	pinNewSite: ( siteId: string ) => void;
}

export const AddSiteContext = createContext< AddSiteContextValue | null >( null );

export function useAddSite(): AddSiteContextValue {
	const value = useContext( AddSiteContext );
	if ( ! value ) throw new Error( 'useAddSite must be used inside the Add site dialog' );
	return value;
}
