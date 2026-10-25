/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { handleDeeplink } from 'src/lib/deeplink/deeplink-handler';
import { markDeeplinkListener, markStudioStarted, openDeeplink } from 'src/lib/deeplink/queue';
import type { WebContents } from 'electron';

vi.mock( 'src/lib/deeplink/deeplink-handler' );
vi.mock( 'src/main-window' );

describe( 'the deep link queue', () => {
	it( 'opens a link that arrives during startup once Studio and its renderer are ready', () => {
		const link = 'wp-studio://app/v1/settings?id=code-editor';
		openDeeplink( link );
		markStudioStarted();
		expect( handleDeeplink ).not.toHaveBeenCalled();

		markDeeplinkListener( { isDestroyed: () => false } as WebContents );
		expect( handleDeeplink ).toHaveBeenCalledExactlyOnceWith( link );

		openDeeplink( 'wp-studio://checkout-return' );
		expect( handleDeeplink ).toHaveBeenLastCalledWith( 'wp-studio://checkout-return' );
		expect( handleDeeplink ).toHaveBeenCalledTimes( 2 );
	} );
} );
