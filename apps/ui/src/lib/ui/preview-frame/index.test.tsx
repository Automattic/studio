import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewFrame, PreviewImage } from './index';

describe( 'preview screenshots', () => {
	it( 'leaves the frame empty when no screenshot is available', () => {
		const { container } = render(
			<PreviewFrame>
				<PreviewImage alt="Site screenshot" />
			</PreviewFrame>
		);
		expect( container.querySelector( '[data-slot="preview-frame"]' ) ).toBeEmptyDOMElement();
	} );

	it( 'removes a failed screenshot and can show a replacement', () => {
		const screenshot = ( src: string ) => (
			<PreviewFrame>
				<PreviewImage src={ src } alt="Site screenshot" />
			</PreviewFrame>
		);
		const { container, rerender } = render( screenshot( '/unavailable.png' ) );
		fireEvent.error( screen.getByRole( 'img', { name: 'Site screenshot' } ) );
		expect( container.querySelector( '[data-slot="preview-frame"]' ) ).toBeEmptyDOMElement();
		rerender( screenshot( '/replacement.png' ) );
		expect( screen.getByRole( 'img', { name: 'Site screenshot' } ) ).toHaveAttribute(
			'src',
			'/replacement.png'
		);
	} );
} );
