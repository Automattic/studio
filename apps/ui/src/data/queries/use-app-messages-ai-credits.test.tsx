import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAiCreditsNoticeForTests } from '@/data/ai-credits-notice';
import { useAiCreditsMeter } from '@/hooks/use-ai-credits-meter';
import { useActivePersistentMessages } from './use-app-messages';
import type { PersistentMessage } from './use-app-messages';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { installAppUpdate: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-app-update', () => ( {
	useAppUpdateStatus: () => ( { data: undefined } ),
} ) );
vi.mock( '@/data/queries/use-user-locale', () => ( { useUserLocale: () => 'en' } ) );
vi.mock( '@/hooks/use-ai-credits-meter', () => ( { useAiCreditsMeter: vi.fn() } ) );

const useMeterMock = vi.mocked( useAiCreditsMeter );

function mockUsage( fraction: number ) {
	useMeterMock.mockReturnValue( {
		fraction,
		usedCredits: 1000000 * fraction,
		totalCredits: 1000000,
		remainingCredits: 1000000 * ( 1 - fraction ),
	} );
}

function wrapper( { children }: { children: ReactNode } ) {
	const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );
	return <QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>;
}

function creditsMessages( messages: PersistentMessage[] ) {
	return messages.filter( ( message ) => message.id.startsWith( 'ai-credits:' ) );
}

describe( 'useActivePersistentMessages AI credits notices', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		resetAiCreditsNoticeForTests();
	} );

	it( 'warns once usage reaches 80%, reporting the live figure', () => {
		mockUsage( 0.83 );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( creditsMessages( result.current.messages ) ).toEqual( [
			expect.objectContaining( {
				id: 'ai-credits:warning',
				title: 'At 83% usage',
				description: 'Add AI credits to keep chatting without interruption.',
				purchaseCta: true,
			} ),
		] );
	} );

	it( 'leaves 90% to the composer strip', () => {
		mockUsage( 0.9 );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( creditsMessages( result.current.messages ) ).toEqual( [] );
	} );

	it( 'stays quiet below 80%', () => {
		mockUsage( 0.5 );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( creditsMessages( result.current.messages ) ).toEqual( [] );
	} );

	it( 'leaves exhaustion to the composer lockout', () => {
		mockUsage( 1 );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( creditsMessages( result.current.messages ) ).toEqual( [] );
	} );

	it( 'stays dismissed while usage sits at the same step', () => {
		mockUsage( 0.83 );
		const { result, rerender } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		act( () => result.current.dismiss( result.current.messages[ 0 ] ) );
		rerender();

		expect( creditsMessages( result.current.messages ) ).toEqual( [] );
	} );

	it( 're-arms after a trip through 90% brings usage back to the 80% step', () => {
		mockUsage( 0.83 );
		const { result, rerender } = renderHook( () => useActivePersistentMessages(), { wrapper } );
		act( () => result.current.dismiss( result.current.messages[ 0 ] ) );

		// Past 90% the strip takes over, which retires the sidebar's dismissal.
		mockUsage( 0.92 );
		rerender();
		expect( creditsMessages( result.current.messages ) ).toEqual( [] );

		mockUsage( 0.85 );
		rerender();

		expect( creditsMessages( result.current.messages ) ).toEqual( [
			expect.objectContaining( { id: 'ai-credits:warning' } ),
		] );
	} );

	it( 're-arms when a top-up drops usage below the dismissed step', () => {
		mockUsage( 0.83 );
		const { result, rerender } = renderHook( () => useActivePersistentMessages(), { wrapper } );
		act( () => result.current.dismiss( result.current.messages[ 0 ] ) );

		mockUsage( 0.5 );
		rerender();
		mockUsage( 0.83 );
		rerender();

		expect( creditsMessages( result.current.messages ) ).toEqual( [
			expect.objectContaining( { id: 'ai-credits:warning' } ),
		] );
	} );
} );
