/**
 * @vitest-environment node
 */
import { vi } from 'vitest';

const mockSendIpcEventToRenderer = vi.fn().mockResolvedValue( undefined );
const mockGetImageData = vi.fn().mockResolvedValue( 'data:image/png;base64,mock' );

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: mockSendIpcEventToRenderer,
} ) );
vi.mock( 'src/lib/get-image-data', () => ( {
	getImageData: mockGetImageData,
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getSiteThumbnailPath: ( id: string ) => `/thumbs/${ id }.png`,
} ) );

const getMock = vi.fn();
vi.mock( 'src/site-server', () => ( {
	SiteServer: {
		get: getMock,
	},
} ) );

describe( 'captureSiteThumbnail', () => {
	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();
	} );

	it( 'updates a running site thumbnail and emits loading and loaded events', async () => {
		const updateCachedThumbnail = vi.fn().mockResolvedValue( undefined );
		getMock.mockReturnValue( {
			details: { id: 'site-1', running: true },
			updateCachedThumbnail,
		} );

		const { captureSiteThumbnail } = await import( 'src/lib/capture-site-thumbnail' );
		await captureSiteThumbnail( 'site-1' );

		expect( updateCachedThumbnail ).toHaveBeenCalledTimes( 1 );
		expect( mockGetImageData ).toHaveBeenCalledWith( '/thumbs/site-1.png' );
		expect( mockSendIpcEventToRenderer ).toHaveBeenCalledWith( 'thumbnail-loading', {
			id: 'site-1',
		} );
		expect( mockSendIpcEventToRenderer ).toHaveBeenCalledWith( 'thumbnail-loaded', {
			id: 'site-1',
			imageData: 'data:image/png;base64,mock',
		} );
	} );

	it( 'deduplicates concurrent captures for the same site', async () => {
		let resolveCapture!: () => void;
		const updateCachedThumbnail = vi.fn(
			() => new Promise< void >( ( resolve ) => ( resolveCapture = resolve ) )
		);
		getMock.mockReturnValue( {
			details: { id: 'site-1', running: true },
			updateCachedThumbnail,
		} );

		const { captureSiteThumbnail } = await import( 'src/lib/capture-site-thumbnail' );
		const first = captureSiteThumbnail( 'site-1' );
		const second = captureSiteThumbnail( 'site-1' );

		await Promise.resolve();
		resolveCapture();
		await Promise.all( [ first, second ] );

		expect( updateCachedThumbnail ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'serializes captures across different sites', async () => {
		let resolveFirst!: () => void;
		const calls: string[] = [];
		const firstCapture = vi.fn(
			() =>
				new Promise< void >( ( resolve ) => {
					calls.push( 'site-1:start' );
					resolveFirst = resolve;
				} )
		);
		const secondCapture = vi.fn().mockImplementation( async () => {
			calls.push( 'site-2:start' );
		} );
		getMock.mockImplementation( ( id: string ) => ( {
			details: { id, running: true },
			updateCachedThumbnail: id === 'site-1' ? firstCapture : secondCapture,
		} ) );

		const { captureSiteThumbnail } = await import( 'src/lib/capture-site-thumbnail' );
		const first = captureSiteThumbnail( 'site-1' );
		const second = captureSiteThumbnail( 'site-2' );

		await Promise.resolve();
		expect( calls ).toEqual( [ 'site-1:start' ] );

		resolveFirst();
		await Promise.all( [ first, second ] );

		expect( calls ).toEqual( [ 'site-1:start', 'site-2:start' ] );
	} );

	it( 'skips stopped sites without emitting loading state', async () => {
		getMock.mockReturnValue( { details: { id: 'site-1', running: false } } );

		const { captureSiteThumbnail } = await import( 'src/lib/capture-site-thumbnail' );
		await captureSiteThumbnail( 'site-1' );

		expect( mockSendIpcEventToRenderer ).not.toHaveBeenCalled();
	} );
} );
