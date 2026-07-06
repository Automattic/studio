import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { getImageFilename, ImageContextMenu } from './index';
import type { Connector } from '@/data/core';
import type { ReactElement, ReactNode } from 'react';

vi.mock( '@/components/menu', () => ( {
	ContextMenuRoot: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	ContextMenuTrigger: ( { render: renderProp }: { render: ReactElement } ) => renderProp,
	ContextPopup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	Item: ( { children, onClick }: { children: ReactNode; onClick?: () => void } ) => (
		<button type="button" onClick={ onClick }>
			{ children }
		</button>
	),
	Separator: () => <hr />,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const { toastSuccess, toastError } = vi.hoisted( () => ( {
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
} ) );

vi.mock( '@/data/app-messages', () => ( {
	toast: { success: toastSuccess, error: toastError },
} ) );

const PNG_DATA_URL = 'data:image/png;base64,stub';

describe( 'getImageFilename', () => {
	it( 'uses the alt text when it looks like an image filename', () => {
		expect( getImageFilename( { src: 'data:', alt: 'screenshot.webp' } ) ).toBe(
			'screenshot.webp'
		);
	} );

	it( 'falls back when the alt text is a description', () => {
		expect( getImageFilename( { src: 'data:', alt: 'The site homepage' }, 'image-2.png' ) ).toBe(
			'image-2.png'
		);
	} );
} );

describe( 'ImageContextMenu', () => {
	const copyImage = vi.fn();
	const copyText = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		copyImage.mockResolvedValue( undefined );
		copyText.mockResolvedValue( undefined );
		vi.mocked( useConnector ).mockReturnValue( { copyImage, copyText } as unknown as Connector );

		// jsdom loads no image data and has no canvas backend — stub the
		// decode → draw → re-encode pipeline the copy action runs through.
		// jsdom's HTMLImageElement lacks `decode` entirely, so define it
		// rather than spy on it.
		HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue( undefined );
		vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue( {
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D );
		vi.spyOn( HTMLCanvasElement.prototype, 'toDataURL' ).mockReturnValue( PNG_DATA_URL );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete ( HTMLImageElement.prototype as Partial< HTMLImageElement > ).decode;
	} );

	function renderMenu( {
		alt = 'photo.png',
		children,
	}: { alt?: string; children?: ReactNode } = {} ) {
		return render(
			<ImageContextMenu
				image={ { src: 'data:image/jpeg;base64,stub', alt } }
				trigger={ <img alt={ alt } /> }
			>
				{ children }
			</ImageContextMenu>
		);
	}

	it( 'copies the image as PNG through the connector', async () => {
		renderMenu();
		screen.getByRole( 'button', { name: 'Copy image' } ).click();
		await waitFor( () => expect( copyImage ).toHaveBeenCalledWith( PNG_DATA_URL ) );
		expect( toastSuccess ).toHaveBeenCalledWith( 'Image copied' );
	} );

	it( 'shows an error toast when copying fails', async () => {
		copyImage.mockRejectedValue( new Error( 'denied' ) );
		renderMenu();
		screen.getByRole( 'button', { name: 'Copy image' } ).click();
		await waitFor( () => expect( toastError ).toHaveBeenCalledWith( 'Failed to copy image' ) );
	} );

	it( 'copies the alt text through the connector', async () => {
		renderMenu( { alt: 'The site homepage' } );
		screen.getByRole( 'button', { name: 'Copy alt text' } ).click();
		await waitFor( () => expect( copyText ).toHaveBeenCalledWith( 'The site homepage' ) );
		expect( toastSuccess ).toHaveBeenCalledWith( 'Alt text copied' );
	} );

	it( 'omits the alt text item when the alt is blank', () => {
		renderMenu( { alt: ' ' } );
		expect( screen.queryByRole( 'button', { name: 'Copy alt text' } ) ).not.toBeInTheDocument();
	} );

	it( 'saves the image using the alt-derived filename', () => {
		const click = vi.spyOn( HTMLAnchorElement.prototype, 'click' ).mockImplementation( function (
			this: HTMLAnchorElement
		) {
			expect( this.download ).toBe( 'photo.png' );
		} );
		renderMenu();
		screen.getByRole( 'button', { name: 'Save image…' } ).click();
		expect( click ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'renders caller items above the shared ones', () => {
		renderMenu( { children: <button type="button">Open image</button> } );
		const menu = screen.getByRole( 'menu' );
		const buttons = Array.from( menu.querySelectorAll( 'button' ) ).map(
			( button ) => button.textContent
		);
		expect( buttons ).toEqual( [ 'Open image', 'Copy image', 'Copy alt text', 'Save image…' ] );
	} );
} );
