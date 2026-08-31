import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	resetAiCreditsNoticeForTests,
	setDismissedAiCreditsIntent,
	useDismissedAiCreditsIntent,
} from './ai-credits-notice';

describe( 'ai credits notice dismissal', () => {
	beforeEach( () => resetAiCreditsNoticeForTests() );

	it( 'starts undismissed, so a fresh run always warns', () => {
		expect( renderHook( () => useDismissedAiCreditsIntent() ).result.current ).toBeNull();
	} );

	it( 'notifies subscribers when the dismissal changes', () => {
		const { result } = renderHook( () => useDismissedAiCreditsIntent() );

		act( () => setDismissedAiCreditsIntent( 'warning' ) );
		expect( result.current ).toBe( 'warning' );

		act( () => setDismissedAiCreditsIntent( null ) );
		expect( result.current ).toBeNull();
	} );
} );
