import { isSupportedLocale } from '@studio/common/lib/locale';
import type {
	ColorScheme,
	QuitSitesBehavior,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';

// Non-empty on purpose: @base-ui's Select treats an item whose value
// stringifies to '' as "no selection" and renders the placeholder instead of
// the item's label.
export const UNSET = 'unset' as const;

export interface PreferencesFormData {
	editor: SupportedEditor | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
	quitSitesBehavior: QuitSitesBehavior | typeof UNSET;
	locale: SupportedLocale;
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
		quitSitesBehavior: prefs.quitSitesBehavior ?? UNSET,
		locale: resolveFormLocale( prefs.locale ),
	};
}

// Maps a form-level change to the writable preferences shape (settings save
// on change, so each control's update becomes its own save patch). The only
// translation needed is the UNSET sentinel: editor/terminal persist it as
// null, quit-sites as undefined ("ask every time").
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
	if ( update.quitSitesBehavior !== undefined ) {
		patch.quitSitesBehavior =
			update.quitSitesBehavior === UNSET ? undefined : update.quitSitesBehavior;
	}
	if ( update.locale !== undefined ) patch.locale = update.locale;

	return patch;
}
