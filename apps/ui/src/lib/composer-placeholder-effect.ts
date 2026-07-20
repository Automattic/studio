/**
 * Cosmetic preference for how the chat composer's placeholder transitions
 * when it rotates to a new suggestion. UI-only, so it lives in localStorage
 * (same pattern as the sidebar sort) and is shared between the settings view
 * and the composer via useSyncExternalStore.
 */

import { useSyncExternalStore } from 'react';

export const COMPOSER_PLACEHOLDER_EFFECTS = [ 'type', 'wave', 'flap', 'fade', 'none' ] as const;

export type ComposerPlaceholderEffect = ( typeof COMPOSER_PLACEHOLDER_EFFECTS )[ number ];

export const DEFAULT_COMPOSER_PLACEHOLDER_EFFECT: ComposerPlaceholderEffect = 'type';

const STORAGE_KEY = 'studio-ui-composer-placeholder-effect-v1';

function isComposerPlaceholderEffect( value: unknown ): value is ComposerPlaceholderEffect {
	return COMPOSER_PLACEHOLDER_EFFECTS.includes( value as ComposerPlaceholderEffect );
}

function read(): ComposerPlaceholderEffect {
	try {
		const stored = window.localStorage.getItem( STORAGE_KEY );
		return isComposerPlaceholderEffect( stored ) ? stored : DEFAULT_COMPOSER_PLACEHOLDER_EFFECT;
	} catch {
		return DEFAULT_COMPOSER_PLACEHOLDER_EFFECT;
	}
}

let effect = read();
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

export function setComposerPlaceholderEffect( next: ComposerPlaceholderEffect ): void {
	effect = next;
	try {
		window.localStorage.setItem( STORAGE_KEY, next );
	} catch {
		// Preference persists per-session only when storage is unavailable.
	}
	emit();
}

export function useComposerPlaceholderEffect(): ComposerPlaceholderEffect {
	return useSyncExternalStore( subscribe, () => effect );
}
