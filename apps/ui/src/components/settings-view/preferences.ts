import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { DEFAULT_RESPONSE_LENGTH } from '@studio/common/ai/response-length';
import {
	resolveActivitySoundPreferences,
	type ActivitySoundPreferences,
} from '@studio/common/lib/activity-sounds';
import { isSupportedLocale } from '@studio/common/lib/locale';
import type {
	ColorScheme,
	QuitSitesBehaviorSetting,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
	ToolPermissionOverrides,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiResponseLength } from '@studio/common/ai/response-length';

export const UNSET = '' as const;

export interface PreferencesFormData {
	editor: SupportedEditor | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
	frameColor: string | null;
	locale: SupportedLocale;
	analyticsEnabled: boolean;
	defaultSiteDirectory: string;
	studioCliInstalled: boolean;
	agenticFeaturesEnabled: boolean;
	chatNotificationsEnabled: boolean;
	activitySoundPreferences: ActivitySoundPreferences;
	quitSitesBehavior: QuitSitesBehaviorSetting;
	agentResponseLength: AiResponseLength;
	defaultAiModel: AiModelId;
	toolPermissions: ToolPermissionOverrides;
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
		frameColor: prefs.frameColor ?? null,
		locale: resolveFormLocale( prefs.locale ),
		// Default to opted-in if absent (e.g. a persisted preferences cache from
		// before this field existed) so the toggle never renders a false negative.
		analyticsEnabled: prefs.analyticsEnabled ?? true,
		defaultSiteDirectory: prefs.defaultSiteDirectory,
		studioCliInstalled: prefs.studioCliInstalled,
		agenticFeaturesEnabled: prefs.agenticFeaturesEnabled,
		// Persisted query caches from before this field existed rehydrate it as
		// undefined; enabled is the real default, so render the toggle on.
		chatNotificationsEnabled: prefs.chatNotificationsEnabled ?? true,
		activitySoundPreferences: resolveActivitySoundPreferences( prefs.activitySoundPreferences ),
		quitSitesBehavior: prefs.quitSitesBehavior ?? 'ask',
		agentResponseLength: prefs.agentResponseLength ?? DEFAULT_RESPONSE_LENGTH,
		defaultAiModel: prefs.defaultAiModel ?? DEFAULT_MODEL,
		toolPermissions: prefs.toolPermissions ?? {},
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
	if ( update.frameColor !== undefined ) patch.frameColor = update.frameColor;
	if ( update.locale !== undefined ) patch.locale = update.locale;
	if ( update.analyticsEnabled !== undefined ) patch.analyticsEnabled = update.analyticsEnabled;
	if ( update.defaultSiteDirectory !== undefined ) {
		patch.defaultSiteDirectory = update.defaultSiteDirectory;
	}
	if ( update.studioCliInstalled !== undefined ) {
		patch.studioCliInstalled = update.studioCliInstalled;
	}
	if ( update.agenticFeaturesEnabled !== undefined ) {
		patch.agenticFeaturesEnabled = update.agenticFeaturesEnabled;
	}
	if ( update.chatNotificationsEnabled !== undefined ) {
		patch.chatNotificationsEnabled = update.chatNotificationsEnabled;
	}
	if ( update.activitySoundPreferences !== undefined ) {
		patch.activitySoundPreferences = update.activitySoundPreferences;
	}
	if ( update.quitSitesBehavior !== undefined ) {
		patch.quitSitesBehavior = update.quitSitesBehavior;
	}
	if ( update.agentResponseLength !== undefined ) {
		patch.agentResponseLength = update.agentResponseLength;
	}
	if ( update.defaultAiModel !== undefined ) {
		patch.defaultAiModel = update.defaultAiModel;
	}
	if ( update.toolPermissions !== undefined ) {
		patch.toolPermissions = update.toolPermissions;
	}

	return patch;
}
