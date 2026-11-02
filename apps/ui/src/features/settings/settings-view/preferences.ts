import { isSupportedLocale } from '@studio/common/lib/locale';
import { INTERFACE_PREFERENCE_DEFAULTS } from '@studio/common/lib/user-settings/preferences';
import type {
	ColorScheme,
	QuitSitesBehavior,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';
import type { SupportedBrowser } from '@studio/common/lib/user-settings/browser';

// Non-empty on purpose: @base-ui's Select treats an item whose value
// stringifies to '' as "no selection" and renders the placeholder instead of
// the item's label.
export const UNSET = 'unset' as const;

export interface PreferencesFormData {
	editor: SupportedEditor | typeof UNSET;
	browser: SupportedBrowser | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
	quitSitesBehavior: QuitSitesBehavior | typeof UNSET;
	locale: SupportedLocale;
	analyticsEnabled: boolean;
	defaultSiteDirectory: string;
	autoStartSiteOnChat: boolean;
	openChatOnSiteStart: boolean;
	confirmDeleteAnnotations: boolean;
}

// The saved locale can be any string the main process resolved (including ones
// outside our catalog). Clamp to a SupportedLocale so form controls always have
// a valid option selected.
function resolveFormLocale( locale: string | undefined ): SupportedLocale {
	return isSupportedLocale( locale ) ? locale : 'en';
}

export function toPreferencesFormData( prefs: UserPreferences ): PreferencesFormData {
	return {
		editor: prefs.editor ?? UNSET,
		browser: prefs.browser ?? UNSET,
		terminal: prefs.terminal ?? UNSET,
		colorScheme: prefs.colorScheme,
		quitSitesBehavior: prefs.quitSitesBehavior ?? UNSET,
		locale: resolveFormLocale( prefs.locale ),
		// Default to opted-in if absent (e.g. a persisted preferences cache from
		// before this field existed) so the toggle never renders a false negative.
		analyticsEnabled: prefs.analyticsEnabled ?? true,
		defaultSiteDirectory: prefs.defaultSiteDirectory,
		autoStartSiteOnChat:
			prefs.autoStartSiteOnChat ?? INTERFACE_PREFERENCE_DEFAULTS.autoStartSiteOnChat,
		openChatOnSiteStart:
			prefs.openChatOnSiteStart ?? INTERFACE_PREFERENCE_DEFAULTS.openChatOnSiteStart,
		confirmDeleteAnnotations:
			prefs.confirmDeleteAnnotations ?? INTERFACE_PREFERENCE_DEFAULTS.confirmDeleteAnnotations,
	};
}

// Maps a form-level change to the writable preferences shape (settings save
// on change, so each control's update becomes its own save patch). The UNSET
// sentinel persists as null, which clears the preference back to its default.
export function toPreferencesPatch(
	update: Partial< PreferencesFormData >
): Partial< WritableUserPreferences > {
	return Object.fromEntries(
		Object.entries( update )
			.filter( ( [ , value ] ) => value !== undefined )
			.map( ( [ key, value ] ) => [ key, value === UNSET ? null : value ] )
	);
}
