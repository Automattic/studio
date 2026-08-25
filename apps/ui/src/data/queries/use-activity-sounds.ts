import { resolveActivitySoundPreferences } from '@studio/common/lib/activity-sounds';
import { useEffect, useRef } from 'react';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { subscribeToSyncActivityEvents } from '@/data/sync-activity';
import { playActivitySound } from '@/lib/activity-sounds';
import type { ActivitySoundPreferences } from '@studio/common/lib/activity-sounds';

export function playConfiguredActivitySound(
	preferences: ActivitySoundPreferences | undefined,
	event: keyof ActivitySoundPreferences[ 'events' ]
): void {
	const resolved = resolveActivitySoundPreferences( preferences );
	if ( ! resolved.enabled ) {
		return;
	}
	const soundId = resolved.events[ event ];
	if ( soundId ) {
		void playActivitySound( soundId );
	}
}

export function useSyncActivitySounds(): void {
	const { data: preferences } = useUserPreferences();
	const preferencesRef = useRef( preferences?.activitySoundPreferences );

	useEffect( () => {
		preferencesRef.current = preferences?.activitySoundPreferences;
	}, [ preferences?.activitySoundPreferences ] );

	useEffect(
		() =>
			subscribeToSyncActivityEvents( ( event ) => {
				playConfiguredActivitySound( preferencesRef.current, event );
			} ),
		[]
	);
}
