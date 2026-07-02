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
	agenticFeaturesEnabled: boolean;
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
		agenticFeaturesEnabled: prefs.agenticFeaturesEnabled,
	};
}

// Maps a form-level change to the writable preferences shape (settings save
// on change, so each control's update becomes its own save patch). The only
// translation needed is the editor/terminal UNSET sentinel, which persists
// as null.
export function toPreferencesPatch(
	update: Partial< PreferencesFormData >
): Partial< WritableUserPreferences > {
	const patch: Partial< WritableUserPreferences > = {};

	if ( update.editor !== undefined ) {
		patch.editor = update.editor === UNSET ? null : update.editor;
	}
	if ( update.terminal !== undefined ) {
		patch.terminal = update.terminal === UNSET ? null : update.terminal;
	}
	if ( update.colorScheme !== undefined ) patch.colorScheme = update.colorScheme;
	if ( update.locale !== undefined ) patch.locale = update.locale;
	if ( update.defaultSiteDirectory !== undefined ) {
		patch.defaultSiteDirectory = update.defaultSiteDirectory;
	}
	if ( update.studioCliInstalled !== undefined ) {
		patch.studioCliInstalled = update.studioCliInstalled;
	}
	if ( update.agenticFeaturesEnabled !== undefined ) {
		patch.agenticFeaturesEnabled = update.agenticFeaturesEnabled;
	}

	return patch;
}
