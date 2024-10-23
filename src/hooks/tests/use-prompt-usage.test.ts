import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '../use-auth';
import { usePromptUsage, PromptUsageProvider } from '../use-prompt-usage';

jest.mock( '../use-auth', () => ( {
	useAuth: jest.fn(),
} ) );

jest.mock( '../use-feature-flags', () => ( {
	useFeatureFlags: jest.fn(),
} ) );

describe( 'usePromptUsage hook', () => {
	const mockClient = {
		req: {
			get: jest.fn().mockResolvedValue( {} ),
		},
	};

	beforeEach( () => {
		( useAuth as jest.Mock ).mockReturnValue( { client: null } );
		jest.useFakeTimers();
		jest.setSystemTime( new Date( '2024-09-16' ) );
	} );

	afterEach( () => {
		jest.useRealTimers();
		jest.clearAllMocks();
	} );

	it( 'should initialize with default values', () => {
		const { result } = renderHook( () => usePromptUsage(), {
			wrapper: PromptUsageProvider,
		} );

		expect( result.current.promptLimit ).toBe( 200 );
		expect( result.current.promptCount ).toBe( 0 );
		expect( result.current.userCanSendMessage ).toBe( true );
		expect( result.current.daysUntilReset ).toBe( NaN );
	} );

	it( 'should fetch prompt usage on mount', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { client: mockClient } );
		mockClient.req.get.mockResolvedValue( {
			max_quota: 250,
			remaining_quota: 150,
			quota_reset_date: '2024-10-01T00:00:00+00:00',
		} );

		const { result } = renderHook( () => usePromptUsage(), {
			wrapper: PromptUsageProvider,
		} );

		await waitFor( () => {
			expect( result.current.promptLimit ).toBe( 250 );
			expect( result.current.promptCount ).toBe( 100 );
			expect( result.current.userCanSendMessage ).toBe( true );
			expect( result.current.daysUntilReset ).toBe( 15 );
		} );
	} );

	it( 'should update prompt usage', async () => {
		const { result } = renderHook( () => usePromptUsage(), {
			wrapper: PromptUsageProvider,
		} );

		act( () => {
			result.current.updatePromptUsage( { maxQuota: '300', remainingQuota: '50' } );
		} );

		expect( result.current.promptLimit ).toBe( 300 );
		expect( result.current.promptCount ).toBe( 250 );
		expect( result.current.userCanSendMessage ).toBe( true );
		expect( result.current.daysUntilReset ).toBe( NaN );
	} );

	it.only( 'should not allow sending message when limit is reached', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { client: mockClient } );
		mockClient.req.get.mockResolvedValue( {
			max_quota: 100,
			remaining_quota: 0,
			quota_reset_date: '2024-10-01T00:00:00+00:00',
		} );

		const { result } = renderHook( () => usePromptUsage(), {
			wrapper: PromptUsageProvider,
		} );

		await waitFor( () => {
			expect( result.current.promptLimit ).toBe( 100 );
			expect( result.current.promptCount ).toBe( 100 );
			expect( result.current.userCanSendMessage ).toBe( false );
			expect( result.current.daysUntilReset ).toBe( 15 );
		} );
	} );
} );
