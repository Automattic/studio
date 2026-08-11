import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ACTIVITY_SOUND_PREFERENCES,
	resolveActivitySoundPreferences,
} from './activity-sounds';

describe( 'resolveActivitySoundPreferences', () => {
	it( 'uses defaults for missing or invalid values while preserving valid choices', () => {
		expect(
			resolveActivitySoundPreferences( {
				enabled: false,
				events: {
					'agent-complete': 'pulse',
					'sync-started': 'not-a-sound',
					'sync-failed': null,
				},
			} )
		).toEqual( {
			enabled: false,
			events: {
				...DEFAULT_ACTIVITY_SOUND_PREFERENCES.events,
				'agent-complete': 'pulse',
				'sync-failed': null,
			},
		} );
	} );
} );
