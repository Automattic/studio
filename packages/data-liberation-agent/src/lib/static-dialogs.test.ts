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
		expect( html ).toContain( '<summary class="burger" data-dla-disclosure-label="Open Menu">' );
		expect( html ).toContain( 'Open Menu' );
		expect( html ).toContain( 'role="dialog"' );
		expect( html ).toContain( 'href="/about"' );
		expect( html ).toContain( 'data-dla-disclosure' );
		expect( html ).toContain( 'data-dla-disclosure-runtime' );
		expect( html ).not.toMatch( /<button[^>]*>Open Menu/ );
	} );

	it( 'wires every copy of the trigger, not just the first', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><button>Open Menu</button><button>Open Menu</button></body></html>',
			[ captured ]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 2 );
	} );

	it( 'replaces the captured portal without retaining its closed source copy', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><button>Open Menu</button><div id="menu" data-visible="false"><nav><a href="/stale">Stale menu</a></nav></div><div id="other-dialog">Keep me</div></body></html>',
			[ captured ]
		);
		expect( html ).not.toContain( 'Stale menu' );
		expect( html ).not.toContain( 'id="menu"' );
		expect( html ).toContain( '<details class="dla-disclosure">' );
		expect( html ).toContain( 'href="/about"' );
		expect( html ).toContain( '<div id="other-dialog">Keep me</div>' );
	} );

	it( 'does not turn an unlabeled logo control into the menu trigger', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><a class="logo" role="button"><img alt="Homepage"></a><button>Open Menu</button></body></html>',
			[ captured ]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 1 );
		expect( html ).toContain( '<a class="logo" role="button"><img alt="Homepage"></a>' );
	} );

	it( 'keeps global attributes without copying element-specific behavior to summary', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><button class="menu" aria-label="Open Menu" data-menu="primary" type="submit" name="menu">Menu</button></body></html>',
			[ captured ]
		);
		expect( html ).toContain(
			'<summary class="menu" aria-label="Open Menu" data-menu="primary" data-dla-disclosure-label="Open Menu">Menu</summary>'
		);
		expect( html ).not.toMatch( /<summary[^>]+(?:type|name)=/ );
	} );

	it( 'replays a captured button trigger onto that button, not a sibling nav link sharing its label', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><header><nav><a href="/#menu">Menu</a><a href="/#concept">Concept</a></nav><button aria-label="Menu"><svg></svg></button></header></body></html>',
			[
				{
					status: 'captured',
					trigger: {
						selector: 'body > header > button',
						tag: 'button',
						ariaHaspopup: '',
						label: 'Menu',
						dataBindings: {},
					},
					dialog: {
						selector: 'nav.md\\:hidden',
						tag: 'nav',
						ariaModal: false,
						html: '<nav class="md:hidden"><a href="/#concept">Concept</a><a href="/#menu">Menu</a></nav>',
						htmlBytes: 78,
						htmlTruncated: false,
					},
				},
			]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 1 );
		expect( html ).toContain( '<a href="/#menu">Menu</a>' );
		expect( html ).toMatch( /<nav><a href="\/#menu">Menu<\/a><a href="\/#concept">Concept<\/a><\/nav>/ );
		expect( html ).toContain( '<summary aria-label="Menu" data-dla-disclosure-label="Menu"><svg></svg></summary>' );
		expect( html ).not.toMatch( /<button[^>]*aria-label="Menu"/ );
	} );

	it( 'still converts the captured button when its selector no longer matches, without touching a navigating Menu link', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><nav><a href="/#menu">Menu</a></nav><div><button>Menu</button></div></body></html>',
			[
				{
					status: 'captured',
					trigger: {
						selector: 'body > header > button',
						tag: 'button',
						ariaHaspopup: '',
						label: 'Menu',
						dataBindings: {},
					},
					dialog: {
						selector: '#drawer',
						tag: 'nav',
						ariaModal: false,
						html: '<nav id="drawer"><a href="/about">About</a></nav>',
						htmlBytes: 48,
						htmlTruncated: false,
					},
				},
			]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 1 );
		expect( html ).toContain( '<a href="/#menu">Menu</a>' );
		expect( html ).not.toMatch( /<nav><details/ );
		expect( html ).toContain( '<summary data-dla-disclosure-label="Menu">Menu</summary>' );
	} );

	it( 'does not convert a navigating link that only shares the captured trigger label', () => {
		const input =
			'<html><head></head><body><nav><a href="/#menu">Menu</a></nav></body></html>';
		const html = wireCapturedDialogs( input, [
			{
				status: 'captured',
				trigger: {
					selector: 'body > header > button',
					tag: 'button',
					ariaHaspopup: '',
					label: 'Menu',
					dataBindings: {},
				},
				dialog: {
					selector: '#drawer',
					tag: 'nav',
					ariaModal: false,
					html: '<nav id="drawer"><a href="/about">About</a></nav>',
					htmlBytes: 48,
					htmlTruncated: false,
				},
			},
		] );
		expect( html ).toContain( '<a href="/#menu">Menu</a>' );
		expect( html ).not.toContain( 'dla-disclosure' );
	} );

	it( 'leaves the page alone when nothing was captured', () => {
		const input = '<html><body><button>Open Menu</button></body></html>';
		expect( wireCapturedDialogs( input, [] ) ).toBe( input );
	} );

	it( 'leaves a disclosure/accordion state alone — its content is already inline, not a popup to wire', () => {
		// hydrateDisclosureContent restores disclosure panels into the live DOM
		// BEFORE the page is serialized, so `html` here already contains the
		// answer. A `kind: 'disclosure'` state must not ALSO be wrapped into a
		// synthetic full-screen `<details>` dialog overlay — that would
		// duplicate the content and misrepresent an inline accordion as a modal.
		const input =
			'<html><head></head><body><button aria-expanded="false" id="t1">Question?</button><div id="p1" hidden role="region" aria-labelledby="t1"><p>Answer text.</p></div></body></html>';
		const html = wireCapturedDialogs( input, [
			{
				status: 'captured',
				kind: 'disclosure',
				trigger: {
					selector: '#t1',
					id: 't1',
					tag: 'button',
					ariaHaspopup: '',
					ariaControls: 'p1',
					label: 'Question?',
					dataBindings: {},
				},
				dialog: {
					selector: '#p1',
					tag: 'div',
					id: 'p1',
					role: 'region',
					ariaModal: false,
					html: '<div id="p1" hidden role="region" aria-labelledby="t1"><p>Answer text.</p></div>',
					htmlBytes: 60,
					htmlTruncated: false,
				},
			},
		] );
		expect( html ).toBe( input );
		expect( html ).not.toContain( 'dla-disclosure' );
	} );

	it( 'leaves a selectable-set state alone — it is shared-region evidence, not a popup to wire', () => {
		const input =
			'<html><head></head><body><div id="z1">Zone 1</div><div id="panel">Placeholder</div></body></html>';
		const html = wireCapturedDialogs( input, [
			{
				status: 'captured',
				kind: 'selectable-set',
				trigger: {
					selector: '#z1',
					id: 'z1',
					tag: 'div',
					ariaHaspopup: '',
					label: 'Zone 1',
					dataBindings: {},
				},
				dialog: {
					selector: '#panel',
					tag: 'div',
					id: 'panel',
					ariaModal: false,
					html: '<div id="panel">Zone 1 details</div>',
					htmlBytes: 36,
					htmlTruncated: false,
				},
				set: { selector: 'body > div:nth-of-type(1)', size: 1, index: 0 },
			},
		] );
		expect( html ).toBe( input );
		expect( html ).not.toContain( 'dla-disclosure' );
	} );

	it( 'wires a listbox popup onto every matching country-code trigger', () => {
		const html = wireCapturedDialogs(
			'<html><head></head><body><button aria-label="Phone. Phone. Select a country code" aria-haspopup="listbox">CA</button><button aria-label="Phone. Phone. Select a country code">CA</button></body></html>',
			[
				{
					status: 'captured',
					trigger: {
						selector: 'body > button',
						tag: 'button',
						ariaHaspopup: 'listbox',
						label: 'Phone. Phone. Select a country code',
						dataBindings: {},
					},
					dialog: {
						selector: '[role="listbox"]',
						tag: 'div',
						role: 'listbox',
						ariaModal: false,
						html: '<div role="listbox"><div role="option">Canada +1</div></div>',
						htmlBytes: 64,
						htmlTruncated: false,
					},
				},
			]
		);
		expect( html.match( /<details class="dla-disclosure">/g ) ).toHaveLength( 2 );
		expect( html ).toContain( 'role="option"' );
		expect( html ).toContain( 'Canada +1' );
	} );
} );
