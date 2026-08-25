import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { vi } from 'vitest';
import { useAiCreditsPurchasedListener } from 'src/hooks/use-ai-credits-purchased-listener';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { wpcomApi } from 'src/stores/wpcom-api';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-ipc-listener' );
vi.mock( 'src/stores', () => ( {
	useAppDispatch: vi.fn(),
} ) );

const showUserSettings = vi.fn();
const dispatch = vi.fn();

describe( 'useAiCreditsPurchasedListener', () => {
	let channel: string | undefined;
	let eventHandler: () => void = () => undefined;

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( { showUserSettings } );
		vi.mocked( useAppDispatch, { partial: true } ).mockReturnValue( dispatch );
		vi.mocked( useIpcListener, { partial: true } ).mockImplementation( ( name, handler ) => {
			channel = name;
			eventHandler = handler as unknown as typeof eventHandler;
		} );
	} );

	it( 'refreshes the quota and opens the account settings on the checkout return', () => {
		renderHook( () => useAiCreditsPurchasedListener() );

		expect( channel ).toBe( 'ai-credits-purchased' );

		act( () => eventHandler() );

		expect( dispatch ).toHaveBeenCalledWith(
			wpcomApi.util.invalidateTags( [ 'StudioAssistantQuota' ] )
		);
		expect( showUserSettings ).toHaveBeenCalledWith( 'account' );
	} );
} );
