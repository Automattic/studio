import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaWidgetThumbnailComponent } from './index';

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
} ) );

describe( 'MediaWidgetThumbnailComponent', () => {
	it( 'renders image thumbnails with an img element so local file URLs are not parsed as CSS URLs', () => {
		const url = 'file:///Users/example/Pictures/Screenshot%20(1).png';
		const { container } = render(
			<MediaWidgetThumbnailComponent
				id="media-1"
				widgetProps={ {
					url,
					mediaKind: 'image',
					alt: 'Screenshot (1).png',
					mediaId: null,
				} }
				isEditing={ false }
				isHovered={ false }
				isSelected={ false }
				onWidgetPropsChange={ vi.fn() }
				onEditComplete={ vi.fn() }
			/>
		);

		const image = container.querySelector( 'img' );

		expect( image ).toBeInTheDocument();
		expect( image ).toHaveAttribute( 'src', url );
		expect( container.firstElementChild ).not.toHaveAttribute( 'style' );
	} );
} );
