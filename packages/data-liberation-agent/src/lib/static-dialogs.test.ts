import { describe, expect, it } from 'vitest';
import { wireCapturedDialogs } from './static-dialogs.js';
import type { CapturedDialogInteraction } from './screenshot/interaction-capture.js';

const captured: CapturedDialogInteraction = {
	status: 'captured',
	trigger: {
		selector: 'body > button',
		tag: 'button',
		ariaHaspopup: '',
		label: 'Open Menu',
		dataBindings: {},
	},
	dialog: {
		selector: '#menu',
		tag: 'div',
		ariaModal: true,
		ariaLabel: 'Menu',
		html: '<nav><a href="/about">About</a></nav>',
		htmlBytes: 32,
		htmlTruncated: false,
	},
};

describe( 'wireCapturedDialogs', () => {
	it( 'wraps a menu button in details so a click opens the captured dialog', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><button class="burger">Open Menu</button></body></html>',
			[ captured ]
		);
		expect( html ).toContain( '<details class="dla-disclosure">' );
		expect( html ).toContain( '<summary class="burger">' );
		expect( html ).toContain( 'Open Menu' );
		expect( html ).toContain( 'role="dialog"' );
		expect( html ).toContain( 'href="/about"' );
		expect( html ).toContain( 'data-dla-disclosure' );
		expect( html ).not.toMatch( /<button[^>]*>Open Menu/ );
	} );

	it( 'wires every copy of the trigger, not just the first', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><button>Open Menu</button><button>Open Menu</button></body></html>',
			[ captured ]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 2 );
	} );

	it( 'does not turn an unlabeled logo control into the menu trigger', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><a class="logo" role="button"><img alt="Homepage"></a><button>Open Menu</button></body></html>',
			[ captured ]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 1 );
		expect( html ).toContain( '<a class="logo" role="button"><img alt="Homepage"></a>' );
	} );

	it( 'leaves the page alone when nothing was captured', () => {
		const input = '<html><body><button>Open Menu</button></body></html>';
		expect( wireCapturedDialogs( input, [] ) ).toBe( input );
	} );
} );
