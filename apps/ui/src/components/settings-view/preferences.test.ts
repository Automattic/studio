import { DEFAULT_ACTIVITY_SOUND_PREFERENCES } from '@studio/common/lib/activity-sounds';
import { describe, expect, it } from 'vitest';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import type { UserPreferences } from '@/data/core';

const SAVED_PREFERENCES: UserPreferences = {
	editor: 'zed',
	terminal: 'terminal',
	colorScheme: 'system',
	locale: 'en',
	defaultSiteDirectory: '/Users/example/Studio',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
	agenticFeaturesEnabled: true,
	chatNotificationsEnabled: true,
	activitySoundPreferences: DEFAULT_ACTIVITY_SOUND_PREFERENCES,
	quitSitesBehavior: 'ask',
	agentResponseLength: 'normal',
	defaultAiModel: 'claude-sonnet-5',
	toolPermissions: {},
};

describe( 'settings preference helpers', () => {
	it( 'resolves form defaults from saved preferences in one place', () => {
		expect(
			toPreferencesFormData( {
				...SAVED_PREFERENCES,
				editor: null,
				terminal: null,
				locale: 'missing-locale',
			} )
		).toEqual( {
			editor: UNSET,
			terminal: UNSET,
			colorScheme: 'system',
			locale: 'en',
			defaultSiteDirectory: '/Users/example/Studio',
			studioCliInstalled: false,
			agenticFeaturesEnabled: true,
			chatNotificationsEnabled: true,
			activitySoundPreferences: DEFAULT_ACTIVITY_SOUND_PREFERENCES,
			quitSitesBehavior: 'ask',
			agentResponseLength: 'normal',
			defaultAiModel: 'claude-sonnet-5',
			toolPermissions: {},
		} );
	} );

	it( 'returns an empty patch for an empty change', () => {
		expect( toPreferencesPatch( {} ) ).toEqual( {} );
	} );

	it( 'maps form changes to writable preferences, persisting UNSET as null', () => {
		expect(
			toPreferencesPatch( {
				editor: UNSET,
				terminal: 'iterm',
				colorScheme: 'dark',
				locale: 'es',
				defaultSiteDirectory: '/Users/example/Sites',
				studioCliInstalled: true,
				agenticFeaturesEnabled: false,
				chatNotificationsEnabled: false,
				agentResponseLength: 'compact',
				defaultAiModel: 'claude-opus-4-8',
			} )
		).toEqual( {
			editor: null,
			terminal: 'iterm',
			colorScheme: 'dark',
			locale: 'es',
			defaultSiteDirectory: '/Users/example/Sites',
			studioCliInstalled: true,
			agenticFeaturesEnabled: false,
			chatNotificationsEnabled: false,
			agentResponseLength: 'compact',
			defaultAiModel: 'claude-opus-4-8',
		} );
	} );

	it( 'includes only the fields present in the change', () => {
		expect( toPreferencesPatch( { locale: 'fr' } ) ).toEqual( { locale: 'fr' } );
		expect( toPreferencesPatch( { studioCliInstalled: false } ) ).toEqual( {
			studioCliInstalled: false,
		} );
	} );
} );
