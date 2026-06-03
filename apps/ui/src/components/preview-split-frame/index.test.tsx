import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { PreviewSplitFrame } from './index';

describe( 'PreviewSplitFrame', () => {
	let getBoundingClientRectSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		window.localStorage.setItem( PREVIEW_PANEL_STORAGE_KEY, '400' );
		getBoundingClientRectSpy = vi
			.spyOn( HTMLElement.prototype, 'getBoundingClientRect' )
			.mockReturnValue( {
				x: 0,
				y: 0,
				width: 1000,
				height: 700,
				top: 0,
				right: 1000,
				bottom: 700,
				left: 0,
				toJSON: () => ( {} ),
			} );
	} );

	afterEach( () => {
		getBoundingClientRectSpy.mockRestore();
		window.localStorage.removeItem( PREVIEW_PANEL_STORAGE_KEY );
	} );

	it( 'lays out the preview immediately when mounted open', async () => {
		render(
			<PreviewSplitFrame
				previewOpen
				preview={ ( { collapsed, layoutWidth } ) => (
					<aside
						aria-label="Site preview"
						data-collapsed={ collapsed ? 'true' : 'false' }
						data-layout-width={ layoutWidth }
					/>
				) }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = screen.getByTestId( 'content' ).parentElement?.parentElement?.parentElement;
		expect( root ).toBeTruthy();

		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' );
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute(
				'data-layout-width',
				'400'
			);
		} );
		expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'false' );
	} );

	it( 'keeps preview space reserved when the first mount measurement is zero', () => {
		getBoundingClientRectSpy.mockReturnValue( {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
			toJSON: () => ( {} ),
		} );

		render(
			<PreviewSplitFrame
				previewOpen
				preview={ ( { collapsed, layoutWidth } ) => (
					<aside
						aria-label="Site preview"
						data-collapsed={ collapsed ? 'true' : 'false' }
						data-layout-width={ layoutWidth }
					/>
				) }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = screen.getByTestId( 'content' ).parentElement?.parentElement?.parentElement;
		expect( root ).toHaveStyle( '--preview-frame-content-width: calc(100% - 400px)' );
		expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-layout-width', '400' );
		expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'false' );
	} );
} );
