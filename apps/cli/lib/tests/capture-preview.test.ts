import { existsSync } from 'node:fs';
import { getSharedBrowser } from '@studio/agent/node';
import { beforeEach, expect, it, vi } from 'vitest';
import { capturePreview } from '../capture-preview';

vi.mock( 'node:fs', () => ( { existsSync: vi.fn() } ) );
vi.mock( '@studio/agent/node', () => ( { getSharedBrowser: vi.fn() } ) );
vi.mock( 'playwright', () => ( { chromium: { executablePath: () => '/chromium' } } ) );

beforeEach( () => vi.clearAllMocks() );

function fakeBrowser( image: Buffer ) {
	const page = {
		goto: vi.fn(),
		addStyleTag: vi.fn(),
		screenshot: vi.fn().mockResolvedValue( image ),
		close: vi.fn(),
	};
	const newPage = vi.fn().mockResolvedValue( page );
	vi.mocked( existsSync ).mockReturnValue( true );
	vi.mocked( getSharedBrowser ).mockResolvedValue( { newPage } as never );
	return { page, newPage };
}

it( 'captures the home page without the admin bar, even when given an inner page', async () => {
	const png = Buffer.from( 'png' );
	const { page, newPage } = fakeBrowser( png );

	expect(
		await capturePreview( 'http://localhost:8888/about/?test=1#heading', {
			width: 800,
			height: 600,
		} )
	).toBe( png );
	expect( newPage ).toHaveBeenCalledWith( {
		viewport: { width: 800, height: 600 },
		deviceScaleFactor: 1,
		ignoreHTTPSErrors: false,
	} );
	expect( page.goto ).toHaveBeenCalledWith(
		'http://localhost:8888/?studio-hide-adminbar',
		expect.any( Object )
	);
	expect( page.addStyleTag ).toHaveBeenCalledWith( {
		content: expect.stringContaining( '#wpadminbar { display: none !important; }' ),
	} );
	expect( page.screenshot ).toHaveBeenCalledWith( {} );
	expect( page.close ).toHaveBeenCalledOnce();
} );

it( 'takes a sharper JPEG when asked', async () => {
	const { page, newPage } = fakeBrowser( Buffer.from( 'jpeg' ) );

	await capturePreview( 'http://localhost:8888', {
		width: 393,
		height: 852,
		scale: 3,
		format: 'jpeg',
	} );

	expect( newPage ).toHaveBeenCalledWith( {
		viewport: { width: 393, height: 852 },
		deviceScaleFactor: 3,
		ignoreHTTPSErrors: false,
	} );
	expect( page.screenshot ).toHaveBeenCalledWith( { type: 'jpeg', quality: 80 } );
} );

it( 'says when no browser is installed', async () => {
	vi.mocked( existsSync ).mockReturnValue( false );

	await expect(
		capturePreview( 'http://localhost:8888', { width: 800, height: 600 } )
	).rejects.toMatchObject( { code: 'no-browser' } );
	expect( getSharedBrowser ).not.toHaveBeenCalled();
} );
