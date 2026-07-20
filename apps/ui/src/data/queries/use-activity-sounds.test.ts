import { DEFAULT_ACTIVITY_SOUND_PREFERENCES } from '@studio/common/lib/activity-sounds';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playActivitySound } from '@/lib/activity-sounds';
import { playConfiguredActivitySound } from './use-activity-sounds';

vi.mock( '@/lib/activity-sounds', () => ( {
	playActivitySound: vi.fn(),
} ) );

const playActivitySoundMock = vi.mocked( playActivitySound );

describe( 'playConfiguredActivitySound', () => {
	beforeEach( () => {
		playActivitySoundMock.mockClear();
	} );

	it( 'plays the sound configured for an event', () => {
		playConfiguredActivitySound( DEFAULT_ACTIVITY_SOUND_PREFERENCES, 'agent-complete' );

		expect( playActivitySoundMock ).toHaveBeenCalledWith( 'soft-chime' );
	} );

	it( 'stays silent when all sounds or the individual event are disabled', () => {
		playConfiguredActivitySound(
			{ ...DEFAULT_ACTIVITY_SOUND_PREFERENCES, enabled: false },
			'agent-complete'
		);
		playConfiguredActivitySound(
			{
				...DEFAULT_ACTIVITY_SOUND_PREFERENCES,
				events: { ...DEFAULT_ACTIVITY_SOUND_PREFERENCES.events, 'agent-complete': null },
			},
			'agent-complete'
		);

		expect( playActivitySoundMock ).not.toHaveBeenCalled();
	} );
} );
