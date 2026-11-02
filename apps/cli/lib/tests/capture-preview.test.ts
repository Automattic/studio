import { existsSync } from 'node:fs';
import { getSharedBrowser } from '@studio/agent/node';
import { beforeEach, expect, it, vi } from 'vitest';
import { capturePreview } from '../capture-preview';

vi.mock( 'node:fs', () => ( { existsSync: vi.fn() } ) );
vi.mock( '@studio/agent/node', () => ( { getSharedBrowser: vi.fn() } ) );
vi.mock( 'playwright', () => ( { chromium: { executablePath: () => '/chromium' } } ) );

beforeEach( () => vi.clearAllMocks() );

it( 'captures the home page without the admin bar, even when given an inner page', async () => {
	const png = Buffer.from( 'png' );
	const page = {
		goto: vi.fn(),
		addStyleTag: vi.fn(),
		screenshot: vi.fn().mockResolvedValue( png ),
		close: vi.fn(),
	};
	vi.mocked( existsSync ).mockReturnValue( true );
	vi.mocked( getSharedBrowser ).mockResolvedValue( {
		newPage: vi.fn().mockResolvedValue( page ),
	} as never );

	expect(
		await capturePreview( 'http://localhost:8888/about/?test=1#heading', {
			width: 800,
			height: 600,
		} )
	).toBe( png );
	expect( page.goto ).toHaveBeenCalledWith(
		'http://localhost:8888/?studio-hide-adminbar',
		expect.any( Object )
	);
	expect( page.addStyleTag ).toHaveBeenCalledWith( {
		content: expect.stringContaining( '#wpadminbar { display: none !important; }' ),
	} );
	expect( page.close ).toHaveBeenCalledOnce();
} );
