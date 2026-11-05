import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { FrameSurface } from './index';

const origin = 'http://localhost:9010';

async function renderFrame( src = origin ) {
	const onAdminBarVisibilityChange = vi.fn();
	const onNavigate = vi.fn();
	const onSettle = vi.fn();
	const onLoadingChange = vi.fn();
	const view = renderWithProviders(
		<FrameSurface
			src={ src }
			title="Preview"
			onLoad={ vi.fn() }
			onSettle={ onSettle }
			onNavigate={ onNavigate }
			onLoadingChange={ onLoadingChange }
			onAdminBarVisibilityChange={ onAdminBarVisibilityChange }
		/>
	);
	const frame = ( await screen.findByTitle( 'Preview' ) ) as HTMLIFrameElement;
	const postMessage = vi.spyOn( frame.contentWindow!, 'postMessage' );
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => new Response() )
	);
	fireEvent.load( frame );
	const navigationId = postMessage.mock.calls.at( -1 )![ 0 ].navigationId as number;
	await act( async () => {} );
	onAdminBarVisibilityChange.mockClear();
	onSettle.mockClear();
	return {
		...view,
		frame,
		onAdminBarVisibilityChange,
		onNavigate,
		onSettle,
		onLoadingChange,
		navigationId,
	};
}

describe( 'preview iframe shortcuts', () => {
	it( 'probes the site root instead of replaying a logout or other action URL', async () => {
		await renderFrame( `${ origin }/wp-login.php?action=logout&_wpnonce=example` );
		expect( fetch ).toHaveBeenCalledExactlyOnceWith(
			`${ origin }/`,
			expect.objectContaining( { method: 'HEAD' } )
		);
	} );
	it( 'only accepts boolean toolbar visibility from its own frame and origin', async () => {
		const { frame, onAdminBarVisibilityChange, navigationId } = await renderFrame();
		for ( const visible of [ false, true ] ) {
			fireEvent(
				window,
				new MessageEvent( 'message', {
					source: frame.contentWindow,
					origin,
					data: { type: 'studio:preview:admin-bar-state', visible, navigationId, url: origin },
				} )
			);
			expect( onAdminBarVisibilityChange ).toHaveBeenLastCalledWith( visible );
		}
		onAdminBarVisibilityChange.mockClear();
		for ( const invalid of [
			{ source: window, origin, visible: true },
			{ source: frame.contentWindow, origin: 'https://unrelated.test', visible: true },
			{ source: frame.contentWindow, origin, visible: 'true' },
		] ) {
			fireEvent(
				window,
				new MessageEvent( 'message', {
					source: invalid.source,
					origin: invalid.origin,
					data: {
						type: 'studio:preview:admin-bar-state',
						visible: invalid.visible,
						navigationId,
						url: origin,
					},
				} )
			);
		}
		expect( onAdminBarVisibilityChange ).not.toHaveBeenCalled();
	} );

	it( 'reports the actual redirect and disables actions as the frame navigates away', async () => {
		const {
			frame,
			onNavigate,
			onSettle,
			onLoadingChange,
			onAdminBarVisibilityChange,
			navigationId,
		} = await renderFrame();
		const report = ( data: object ) =>
			fireEvent(
				window,
				new MessageEvent( 'message', {
					source: frame.contentWindow,
					origin,
					data: { navigationId, ...data },
				} )
			);
		report( {
			type: 'studio:preview:admin-bar-state',
			visible: true,
			url: `${ origin }/wp-admin/`,
			title: 'Dashboard',
		} );
		expect( onNavigate ).toHaveBeenCalledWith( `${ origin }/wp-admin/` );
		expect( onSettle ).toHaveBeenCalledWith( `${ origin }/wp-admin/`, 'Dashboard', false );
		expect( frame.src ).toBe( `${ origin }/` );
		report( { type: 'studio:preview:navigating' } );
		expect( onAdminBarVisibilityChange ).toHaveBeenLastCalledWith( null );
		expect( onLoadingChange ).toHaveBeenLastCalledWith( true );
	} );

	it( 'ignores stale documents and off-origin or malformed reported URLs', async () => {
		const { frame, onNavigate, navigationId } = await renderFrame();
		for ( const payload of [
			{ url: origin, navigationId: navigationId - 1 },
			{ url: 'https://unrelated.test/', navigationId },
			{ url: 'invalid', navigationId },
		] )
			fireEvent(
				window,
				new MessageEvent( 'message', {
					source: frame.contentWindow,
					origin,
					data: { type: 'studio:preview:admin-bar-state', visible: true, ...payload },
				} )
			);
		expect( onNavigate ).not.toHaveBeenCalled();
	} );

	it( 'does not let a delayed health probe overwrite a trusted page report or an unmounted frame', async () => {
		const { frame, onSettle, navigationId, unmount } = await renderFrame();
		let rejectProbe = () => {};
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise( ( _resolve, reject ) => {
						rejectProbe = () => reject( new Error( 'offline' ) );
					} )
			)
		);
		fireEvent.load( frame );
		fireEvent(
			window,
			new MessageEvent( 'message', {
				source: frame.contentWindow,
				origin,
				data: {
					type: 'studio:preview:admin-bar-state',
					visible: true,
					navigationId: navigationId + 1,
					url: `${ origin }/sample-page/`,
					title: 'Sample page',
				},
			} )
		);
		await act( async () => rejectProbe() );
		expect( onSettle ).toHaveBeenCalledExactlyOnceWith(
			`${ origin }/sample-page/`,
			'Sample page',
			false
		);
		fireEvent.load( frame );
		unmount();
		await act( async () => rejectProbe() );
		expect( onSettle ).toHaveBeenCalledOnce();
	} );

	it( 'forwards a palette request from its own frame to the app keyboard handler', async () => {
		const { frame, unmount } = await renderFrame();
		const keydown = vi.fn();
		document.addEventListener( 'keydown', keydown );
		const message = {
			source: frame.contentWindow,
			origin,
			data: { type: 'studio:preview-shortcuts:command-palette' },
		};
		try {
			fireEvent( window, new MessageEvent( 'message', message ) );
			expect( keydown ).toHaveBeenCalledWith(
				expect.objectContaining( { key: 'k', code: 'KeyK' } )
			);
			unmount();
			keydown.mockClear();
			fireEvent( window, new MessageEvent( 'message', message ) );
			expect( keydown ).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener( 'keydown', keydown );
		}
	} );

	it( 'ignores messages from other windows or origins', async () => {
		const { frame } = await renderFrame();
		const keydown = vi.fn();
		document.addEventListener( 'keydown', keydown );
		try {
			for ( const message of [
				{ source: window, origin },
				{ source: frame.contentWindow, origin: 'https://example.com' },
			] ) {
				fireEvent(
					window,
					new MessageEvent( 'message', {
						...message,
						data: { type: 'studio:preview-shortcuts:command-palette' },
					} )
				);
			}
			expect( keydown ).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener( 'keydown', keydown );
		}
	} );
} );
