/**
 * TEMPORARY prototype state for the (simulated) WordPress.org connection.
 *
 * WordPress.org has no OAuth and its login is reCAPTCHA + 2FA guarded, so we
 * can't automate a real capture flow. Instead "logging in" pops a dialog
 * explaining it's simulated; clicking OK flips this flag. Backed by
 * localStorage so the connected state survives reloads, and shared across the
 * settings row and the plugin connect screen via useSyncExternalStore.
 */

import { useSyncExternalStore } from 'react';

// The account the simulation pretends to be connected as.
export const SIMULATED_WPORG_USERNAME = 'automattic';

const STORAGE_KEY = 'studio-ui-prototype-wporg-connected-v1';

function read(): boolean {
	try {
		return window.localStorage.getItem( STORAGE_KEY ) === 'true';
	} catch {
		return false;
	}
}

let connected = read();
const listeners = new Set< () => void >();

function emit() {
	for ( const listener of listeners ) {
		listener();
	}
}

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

export function setWporgConnected( next: boolean ): void {
	connected = next;
	try {
		window.localStorage.setItem( STORAGE_KEY, next ? 'true' : 'false' );
	} catch {
		// Prototype-only storage.
	}
	emit();
}

/** True when the simulated WordPress.org account is "connected". */
export function useWporgConnected(): boolean {
	return useSyncExternalStore( subscribe, () => connected );
}
