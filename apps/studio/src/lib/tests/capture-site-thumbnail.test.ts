import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSitePreview, writeSitePreview } from '@studio/common/lib/site-preview-cache';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { createScreenshotWindow } from 'src/screenshot-window';
import { getSiteThumbnailPath } from 'src/storage/paths';
import { captureSiteThumbnail } from '../capture-site-thumbnail';

vi.mock( '@studio/common/lib/well-known-paths', () => ( { getConfigDirectory: vi.fn() } ) );
vi.mock( 'src/screenshot-window', () => ( { createScreenshotWindow: vi.fn() } ) );
vi.mock( 'src/storage/paths', () => ( { getSiteThumbnailPath: vi.fn() } ) );

let directory: string;
beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-thumbnail-' ) );
	vi.mocked( getConfigDirectory ).mockReturnValue( directory );
	vi.mocked( getSiteThumbnailPath ).mockReturnValue( path.join( directory, 'fallback.png' ) );
} );
afterEach( async () => {
	await fs.rm( directory, { recursive: true, force: true } );
	vi.clearAllMocks();
} );

it( 'replaces a pre-existing shared preview after a home-page capture', async () => {
	await writeSitePreview( 'site-a', Buffer.from( 'old-page' ) );
	const png = Buffer.from( 'home-page' );
	const destroy = vi.fn();
	vi.mocked( createScreenshotWindow ).mockReturnValue( {
		window: { destroy },
		waitForCapture: async () => ( { toPNG: () => png } ),
	} as never );

	await captureSiteThumbnail( { id: 'site-a', url: 'http://localhost:8885/about/' } );

	expect( createScreenshotWindow ).toHaveBeenCalledWith(
		'http://localhost:8885/?studio-hide-adminbar'
	);
	expect( await readSitePreview( 'site-a', getSiteThumbnailPath( 'site-a' ) ) ).toBe(
		`data:image/png;base64,${ png.toString( 'base64' ) }`
	);
	expect( await fs.readFile( getSiteThumbnailPath( 'site-a' ) ) ).toEqual( png );
	expect( destroy ).toHaveBeenCalledOnce();
} );
