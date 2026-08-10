import type { OnboardingHintsState } from '../types';

// Workbench onboarding state. The desktop persists this in appdata via IPC; the
// browser connectors (local + hosted) have no such store, so it lives in
// localStorage, per origin.
const ONBOARDING_HINTS_STORAGE_KEY = 'studio-onboarding-hints';

export function readOnboardingHints(): OnboardingHintsState {
	try {
		const raw = window.localStorage.getItem( ONBOARDING_HINTS_STORAGE_KEY );
		const parsed: unknown = raw ? JSON.parse( raw ) : {};
		return parsed && typeof parsed === 'object' ? ( parsed as OnboardingHintsState ) : {};
	} catch {
		return {};
	}
}

export function writeOnboardingHints( partial: Partial< OnboardingHintsState > ): void {
	const current = readOnboardingHints();
	const merged: OnboardingHintsState = {
		...current,
		...partial,
		completedItems: { ...( current.completedItems ?? {} ), ...( partial.completedItems ?? {} ) },
	};
	window.localStorage.setItem( ONBOARDING_HINTS_STORAGE_KEY, JSON.stringify( merged ) );
}
