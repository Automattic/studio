import { describe, expect, it, vi } from 'vitest';
import { createScreenshotTaker, SCREENSHOT_LAYOUTS } from '../site-screenshot';

const site = { id: 's1', url: 'http://localhost:8881', running: true };

describe( 'createScreenshotTaker', () => {
	it( 'takes a JPEG of the site at the size of the layout', async () => {
		const capture = vi.fn().mockResolvedValue( Buffer.from( 'jpeg' ) );
		const take = createScreenshotTaker( capture, () => 1000 );

		expect( await take( site, 'phone' ) ).toEqual( {
			image: `data:image/jpeg;base64,${ Buffer.from( 'jpeg' ).toString( 'base64' ) }`,
			takenAt: 1000,
		} );
		expect( capture ).toHaveBeenCalledWith( 'http://localhost:8881', {
			width: 393,
			height: 852,
			scale: 3,
			format: 'jpeg',
		} );

		await take( site, 'desktop' );
		expect( capture ).toHaveBeenLastCalledWith( 'http://localhost:8881', {
			...SCREENSHOT_LAYOUTS.desktop,
			format: 'jpeg',
		} );
		expect( SCREENSHOT_LAYOUTS.desktop ).toEqual( { width: 1280, height: 800, scale: 2 } );
	} );

	it( 'says why there is no image', async () => {
		const failing = vi.fn().mockRejectedValue( new Error( 'timeout' ) );
		const noBrowser = vi
			.fn()
			.mockRejectedValue( Object.assign( new Error( 'no Chromium' ), { code: 'no-browser' } ) );

		expect(
			await createScreenshotTaker( failing )( { ...site, running: false }, 'phone' )
		).toEqual( { image: null, reason: 'stopped' } );
		expect( failing ).not.toHaveBeenCalled();
		expect( await createScreenshotTaker( undefined )( site, 'phone' ) ).toEqual( {
			image: null,
			reason: 'no-browser',
		} );
		expect( await createScreenshotTaker( noBrowser )( site, 'phone' ) ).toEqual( {
			image: null,
			reason: 'no-browser',
		} );
		expect( await createScreenshotTaker( failing )( site, 'phone' ) ).toEqual( {
			image: null,
			reason: 'failed',
		} );
	} );

	it( 'takes one shot per site and layout at a time, and a new one after it', async () => {
		const finish: Array< ( image: Buffer ) => void > = [];
		const capture = vi.fn(
			() =>
				new Promise< Buffer >( ( resolve ) => {
					finish.push( resolve );
				} )
		);
		const take = createScreenshotTaker( capture, () => 1000 );

		const first = take( site, 'phone' );
		const second = take( site, 'phone' );
		void take( site, 'desktop' );
		expect( capture ).toHaveBeenCalledTimes( 2 );

		finish[ 0 ]( Buffer.from( 'x' ) );
		expect( await second ).toEqual( await first );

		void take( site, 'phone' );
		expect( capture ).toHaveBeenCalledTimes( 3 );
		finish.forEach( ( resolve ) => resolve( Buffer.from( 'y' ) ) );
	} );

	it( 'counts the limit from when the request came', async () => {
		vi.useFakeTimers();
		try {
			const take = createScreenshotTaker( () => new Promise< Buffer >( () => undefined ) );
			// Listing the sites took 3 s before the shot started.
			const shot = take( site, 'phone', Date.now() - 3000 );

			await vi.advanceTimersByTimeAsync( 5000 );

			expect( await shot ).toEqual( { image: null, reason: 'failed' } );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'gives up after the limit, and lets a new request wait for the same capture', async () => {
		vi.useFakeTimers();
		try {
			const finish: Array< ( image: Buffer ) => void > = [];
			const capture = vi.fn(
				() =>
					new Promise< Buffer >( ( resolve ) => {
						finish.push( resolve );
					} )
			);
			const take = createScreenshotTaker( capture, () => 1000 );
			const shot = take( site, 'phone' );

			await vi.advanceTimersByTimeAsync( 8000 );
			expect( await shot ).toEqual( { image: null, reason: 'failed' } );

			const again = take( site, 'phone' );
			expect( capture ).toHaveBeenCalledTimes( 1 );
			finish[ 0 ]( Buffer.from( 'late' ) );
			expect( await again ).toEqual( {
				image: `data:image/jpeg;base64,${ Buffer.from( 'late' ).toString( 'base64' ) }`,
				takenAt: 1000,
			} );

			void take( site, 'phone' );
			expect( capture ).toHaveBeenCalledTimes( 2 );
			finish[ 1 ]( Buffer.from( 'y' ) );
		} finally {
			vi.useRealTimers();
		}
	} );
} );
