import { createMcpUpdateNotice } from 'cli/ai/runtimes/mcp/update-notice';
import { getAvailableCliUpdate } from 'cli/lib/update-notifier';

vi.mock( 'cli/lib/update-notifier', async ( original ) => ( {
	...( await original< typeof import('cli/lib/update-notifier') >() ),
	getAvailableCliUpdate: vi.fn(),
} ) );

afterEach( () => vi.useRealTimers() );

it( 'exposes the update in instructions and one tool result per version, including long sessions', async () => {
	vi.useFakeTimers();
	vi.mocked( getAvailableCliUpdate ).mockResolvedValue( {
		currentVersion: '1.0.0',
		latestVersion: '2.0.0',
		updateCommand: 'studio update',
	} );
	const notice = createMcpUpdateNotice( '1.0.0', 'standalone' );
	expect( await notice.instructions() ).toContain( '1.0.0 → 2.0.0' );
	expect( await notice.forToolResult() ).toContain( '`studio update`' );
	expect( await notice.forToolResult() ).toBe( '' );
	expect( getAvailableCliUpdate ).toHaveBeenCalledTimes( 1 );
	vi.mocked( getAvailableCliUpdate ).mockResolvedValue( {
		currentVersion: '1.0.0',
		latestVersion: '2.1.0',
		updateCommand: 'studio update',
	} );
	vi.advanceTimersByTime( 24 * 60 * 60 * 1000 );
	expect( await notice.forToolResult() ).toContain( '1.0.0 → 2.1.0' );
} );

it( 'keeps tools usable when there is no update or the check fails', async () => {
	vi.mocked( getAvailableCliUpdate ).mockResolvedValueOnce( null );
	const current = createMcpUpdateNotice( '2.0.0', 'embedded' );
	expect( await current.instructions() ).toBe( '' );
	expect( await current.forToolResult() ).toBe( '' );
	vi.mocked( getAvailableCliUpdate ).mockRejectedValueOnce( new Error( 'offline' ) );
	expect( await createMcpUpdateNotice( '2.0.0', 'npm' ).forToolResult() ).toBe( '' );
} );
