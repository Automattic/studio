import { isSupportedLocale } from '@studio/common/lib/locale';
import type {
	ColorScheme,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';

export const UNSET = '' as const;

export interface PreferencesFormData {
	editor: SupportedEditor | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
	locale: SupportedLocale;
	defaultSiteDirectory: string;
	studioCliInstalled: boolean;
}

// The saved locale can be any string the main process resolved (including ones
// outside our catalog). Clamp to a SupportedLocale so form controls always have
// a valid option selected.
export function resolveFormLocale( locale: string | undefined ): SupportedLocale {
	return isSupportedLocale( locale ) ? locale : 'en';
}

export function toPreferencesFormData( prefs: UserPreferences ): PreferencesFormData {
	return {
		editor: prefs.editor ?? UNSET,
		terminal: prefs.terminal ?? UNSET,
		colorScheme: prefs.colorScheme,
		locale: resolveFormLocale( prefs.locale ),
		defaultSiteDirectory: prefs.defaultSiteDirectory,
		studioCliInstalled: prefs.studioCliInstalled,
	};
}

export function diffPreferencesFromSaved(
	next: PreferencesFormData,
	saved: UserPreferences
): Partial< WritableUserPreferences > {
	const patch: Partial< WritableUserPreferences > = {};
	const nextEditor: SupportedEditor | null = next.editor === UNSET ? null : next.editor;
	const nextTerminal: SupportedTerminal | null = next.terminal === UNSET ? null : next.terminal;

	if ( nextEditor !== saved.editor ) patch.editor = nextEditor;
	if ( nextTerminal !== saved.terminal ) patch.terminal = nextTerminal;
	if ( next.colorScheme !== saved.colorScheme ) patch.colorScheme = next.colorScheme;
	if ( next.locale !== resolveFormLocale( saved.locale ) ) patch.locale = next.locale;
	if ( next.defaultSiteDirectory !== saved.defaultSiteDirectory ) {
		patch.defaultSiteDirectory = next.defaultSiteDirectory;
	}
	if ( next.studioCliInstalled !== saved.studioCliInstalled ) {
		patch.studioCliInstalled = next.studioCliInstalled;
	}

	return patch;
}
