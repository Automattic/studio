import { describe, expect, it } from 'vitest';
import { buttonsWithoutLinkNotes } from 'cli/ai/button-links';

const button = ( link: string, attributes = '' ) =>
	`<!-- wp:button ${ attributes }--><div class="wp-block-button">${ link }</div><!-- /wp:button -->`;

describe( 'buttons that open nothing', () => {
	it.each( [
		{
			// As run 33's 01a176a7-8cec wrote its product cards' "Add" buttons.
			name: 'buttons written without a link, counted by their text',
			markup: [
				button(
					'<a class="wp-block-button__link wp-element-button">Add</a>',
					'{"className":"is-style-fill"} '
				),
				button( '<a class="wp-block-button__link wp-element-button">Add</a>' ),
				button( '<a class="wp-block-button__link" href="#"><strong>Buy</strong> now</a>' ),
				button( '<a class="wp-block-button__link" href="/shop/">Shop</a>' ),
			].join( '' ),
			named: '"Add" ×2, "Buy now"',
		},
		{
			name: 'a button with a link',
			markup: button(
				'<a class="wp-block-button__link" href="https://example.com/#order">Order</a>'
			),
			named: undefined,
		},
		{
			name: 'a button that is a form button by its tagName',
			markup: button(
				'<button type="submit" class="wp-block-button__link">Send</button>',
				'{"tagName":"button"} '
			),
			named: undefined,
		},
		{
			name: 'a button with no text',
			markup: button( '<a class="wp-block-button__link"></a>' ),
			named: '"(no text)"',
		},
	] )( 'names $name', ( { markup, named } ) => {
		expect( buttonsWithoutLinkNotes( markup ) ).toEqual(
			named
				? [
						`core/button blocks that open nothing: ${ named }. A button's link is its "url", saved as the href of its <a> (wp-includes/blocks/button/block.json); without one the browser gives the link no action, and "#" opens the top of the page. Give each the URL of what it offers.`,
				  ]
				: []
		);
	} );
} );
