import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { FrameSurface } from './index';

const origin = 'http://localhost:9010';

async function renderFrame() {
	const onAdminBarVisibilityChange = vi.fn();
	const view = renderWithProviders(
		<FrameSurface
			src={ origin }
			title="Preview"
			onLoad={ vi.fn() }
			onSettle={ vi.fn() }
			onAdminBarVisibilityChange={ onAdminBarVisibilityChange }
		/>
	);
	const frame = ( await screen.findByTitle( 'Preview' ) ) as HTMLIFrameElement;
	return { ...view, frame, onAdminBarVisibilityChange };
}

describe( 'preview iframe shortcuts', () => {
	it( 'only accepts boolean toolbar visibility from its own frame and origin', async () => {
		const { frame, onAdminBarVisibilityChange } = await renderFrame();
		for ( const visible of [ false, true ] ) {
			fireEvent(
				window,
				new MessageEvent( 'message', {
					source: frame.contentWindow,
					origin,
					data: { type: 'studio:preview:admin-bar-state', visible },
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
					data: { type: 'studio:preview:admin-bar-state', visible: invalid.visible },
				} )
			);
		}
		expect( onAdminBarVisibilityChange ).not.toHaveBeenCalled();
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
