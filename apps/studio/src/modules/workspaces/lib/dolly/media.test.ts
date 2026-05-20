import { describe, expect, it } from 'vitest';
import {
	createWorkspaceDollyVisibleMessage,
	isWorkspaceDollyRenderableImageLinkUrl,
	isWorkspaceDollyRenderableImageUrl,
} from 'src/modules/workspaces/lib/dolly/media';

describe( 'workspace Dolly media helpers', () => {
	const customSiteUrl = 'https://bravely-so-donut.commerce-garden.com';

	it( 'renders uploaded media as image markdown', () => {
		expect(
			createWorkspaceDollyVisibleMessage(
				'Please look at this.',
				[
					{
						name: 'Dapper Dog [draft]',
						url: 'https://bravely-so-donut.commerce-garden.com/wp-content/uploads/2026/05/dapper-dog.png',
					},
				],
				1
			)
		).toBe(
			'Please look at this.\n\n![Dapper Dog \\[draft\\]](https://bravely-so-donut.commerce-garden.com/wp-content/uploads/2026/05/dapper-dog.png)'
		);
	} );

	it( 'allows only local previews and active-site image URLs', () => {
		expect( isWorkspaceDollyRenderableImageUrl( 'data:image/png;base64,abc' ) ).toBe( true );
		expect( isWorkspaceDollyRenderableImageUrl( 'blob:http://localhost/image' ) ).toBe( true );
		expect(
			isWorkspaceDollyRenderableImageUrl(
				'https://bravely-so-donut.commerce-garden.com/wp-content/uploads/2026/05/dapper-dog.png',
				customSiteUrl
			)
		).toBe( true );
		expect(
			isWorkspaceDollyRenderableImageUrl(
				'https://horsing-around.files.wordpress.com/2026/05/dapper-dog.png',
				customSiteUrl
			)
		).toBe( false );
		expect(
			isWorkspaceDollyRenderableImageUrl( 'https://i0.wp.com/example.com/image.png', customSiteUrl )
		).toBe( false );
		expect(
			isWorkspaceDollyRenderableImageUrl( 'https://cdn.example.com/image.png', customSiteUrl )
		).toBe( false );
		expect(
			isWorkspaceDollyRenderableImageUrl(
				'http://bravely-so-donut.commerce-garden.com/wp-content/uploads/2026/05/dapper-dog.png',
				customSiteUrl
			)
		).toBe( false );
	} );

	it( 'only upgrades active-site direct image links to inline previews', () => {
		expect(
			isWorkspaceDollyRenderableImageLinkUrl(
				'https://bravely-so-donut.commerce-garden.com/wp-content/uploads/2026/05/dapper-dog.webp',
				customSiteUrl
			)
		).toBe( true );
		expect(
			isWorkspaceDollyRenderableImageLinkUrl(
				'https://bravely-so-donut.commerce-garden.com/wp-content/uploads/2026/05/dapper-dog',
				customSiteUrl
			)
		).toBe( false );
		expect(
			isWorkspaceDollyRenderableImageLinkUrl( 'https://cdn.example.com/image.png', customSiteUrl )
		).toBe( false );
	} );
} );
