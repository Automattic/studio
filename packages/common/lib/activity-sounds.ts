export const ACTIVITY_SOUND_IDS = [ 'soft-chime', 'bright-chime', 'pop', 'pulse' ] as const;

export type ActivitySoundId = ( typeof ACTIVITY_SOUND_IDS )[ number ];

export const ACTIVITY_SOUND_EVENTS = [
	'attention-required',
	'agent-complete',
	'sync-started',
	'sync-complete',
	'sync-failed',
] as const;

export type ActivitySoundEvent = ( typeof ACTIVITY_SOUND_EVENTS )[ number ];

export type ActivitySoundPreferences = {
	enabled: boolean;
	events: Record< ActivitySoundEvent, ActivitySoundId | null >;
};

export const DEFAULT_ACTIVITY_SOUND_PREFERENCES: ActivitySoundPreferences = {
	enabled: true,
	events: {
		'attention-required': 'bright-chime',
		'agent-complete': 'soft-chime',
		'sync-started': 'pulse',
		'sync-complete': 'soft-chime',
		'sync-failed': 'pop',
	},
};

export function isActivitySoundId( value: unknown ): value is ActivitySoundId {
	return ACTIVITY_SOUND_IDS.includes( value as ActivitySoundId );
}

export function resolveActivitySoundPreferences( value: unknown ): ActivitySoundPreferences {
	if ( ! value || typeof value !== 'object' ) {
		return DEFAULT_ACTIVITY_SOUND_PREFERENCES;
	}

	const candidate = value as {
		enabled?: unknown;
		events?: Partial< Record< ActivitySoundEvent, unknown > >;
	};
	const events = { ...DEFAULT_ACTIVITY_SOUND_PREFERENCES.events };

	for ( const event of ACTIVITY_SOUND_EVENTS ) {
		const sound = candidate.events?.[ event ];
		if ( sound === null || isActivitySoundId( sound ) ) {
			events[ event ] = sound;
		}
	}

	return {
		enabled:
			typeof candidate.enabled === 'boolean'
				? candidate.enabled
				: DEFAULT_ACTIVITY_SOUND_PREFERENCES.enabled,
		events,
	};
}
