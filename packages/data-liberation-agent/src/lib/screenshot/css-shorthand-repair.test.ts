import { describe, it, expect } from 'vitest';
import { repairShorthandVarCollapse } from './css-shorthand-repair.js';

describe( 'repairShorthandVarCollapse', () => {
	it( 'recovers a font shorthand-with-var() that the CSSOM collapsed to empty longhands', () => {
		// This is the exact shape Chromium's CSSOM serializes for a rule like
		// `.foo { font: var(--x); font-style: normal; color: red; }`: the shorthand
		// vanishes and every one of its longhands serializes as an empty declaration.
		const live =
			'.foo { font-variant-ligatures: ; font-variant-caps: ; font-variant-numeric: ; ' +
			'font-variant-east-asian: ; font-variant-alternates: ; font-variant-position: ; ' +
			'font-variant-emoji: ; font-weight: ; font-stretch: ; font-size: ; line-height: ; ' +
			'font-family: ; font-optical-sizing: ; font-size-adjust: ; font-kerning: ; ' +
			'font-feature-settings: ; font-variation-settings: ; font-language-override: ; ' +
			'font-style: normal; color: red; }';
		const original = '.foo { font: var(--x); font-style: normal; color: red; }';

		expect( repairShorthandVarCollapse( live, original ) ).toContain(
			'.foo { font: var(--x); font-style: normal; color: red; }'
		);
	} );

	it( 'does not repair when there is no matching original rule (a genuine post-load CSSOM mutation)', () => {
		const live = '.inserted { font-weight: ; font-family: ; color: blue; }';
		const original = '.other { color: green; }'; // unrelated rule, e.g. the sheet before JS inserted .inserted
		const result = repairShorthandVarCollapse( live, original );
		expect( result ).toContain( 'font-weight: ;' );
		expect( result ).toContain( 'font-family: ;' );
	} );

	it( 'is a no-op (byte-identical) for ordinary CSS with no empty-declaration signature', () => {
		const live = '.a { color: red; } .b { font-family: Arial, sans-serif; }';
		const original = live;
		expect( repairShorthandVarCollapse( live, original ) ).toBe( live );
	} );

	it( 'repairs a rule nested inside @media without disturbing sibling rules', () => {
		const live =
			'.top { color: red; }\n' +
			'@media (max-width: 1023px) { .foo { font-weight: ; font-family: ; text-align: start; } }';
		const original =
			'.top { color: red; }\n' +
			'@media (max-width: 1023px) { .foo { font: var(--wst-paragraph-2-font); text-align: start; } }';

		const result = repairShorthandVarCollapse( live, original );
		expect( result ).toContain( '.top { color: red; }' );
		expect( result ).toContain( 'font: var(--wst-paragraph-2-font)' );
		expect( result ).not.toContain( 'font-family: ;' );
	} );

	it( 'matches same-selector rules by occurrence order, not just selector text', () => {
		// Two physically separate rules share the exact selector — common with
		// `:where()`-scoped generated CSS (a sizing rule and a font rule for the
		// same component). The second occurrence must repair against the second
		// occurrence, not the first.
		const live =
			'#id { width: 10px; }\n' +
			'#id { font-weight: ; font-family: ; color: black; }';
		const original =
			'#id { width: 10px; }\n' +
			'#id { font: var(--token); color: black; }';

		const result = repairShorthandVarCollapse( live, original );
		expect( result ).toContain( '#id { width: 10px; }' );
		expect( result ).toContain( 'font: var(--token); color: black;' );
	} );

	it( 'leaves rules genuinely inserted by JS after load untouched, alongside an unrelated repaired rule', () => {
		const live =
			'.foo { font-weight: ; font-family: ; color: red; }\n' +
			'.mobile { display: block; }'; // inserted via sheet.insertRule() after original text was read
		const original = '.foo { font: var(--x); color: red; }'; // .mobile does not exist here

		const result = repairShorthandVarCollapse( live, original );
		expect( result ).toContain( 'font: var(--x); color: red;' );
		expect( result ).toContain( '.mobile { display: block; }' );
	} );

	it( 'does not repair when the candidate original rule is itself empty (nothing to recover)', () => {
		const live = '.foo { font-weight: ; color: red; }';
		const original = '.foo { font-weight: ; color: red; }';
		const result = repairShorthandVarCollapse( live, original );
		expect( result ).toContain( 'font-weight: ;' );
	} );
} );

describe( 'CSS_SHORTHAND_REPAIR_FACTORY_SOURCE', () => {
	// The browser receives this factory as text. Build it the way the shipped
	// runtime bundle does (minified) and run it with no module scope around it:
	// any helper it reaches by a module-level name is then undefined, which is
	// how every page of a matching site failed to capture in the bundle.
	it( 'repairs from a minified build with no module scope', async () => {
		const { build } = await import( 'esbuild' );
		const { fileURLToPath } = await import( 'node:url' );
		const result = await build( {
			entryPoints: [ fileURLToPath( new URL( './css-shorthand-repair.ts', import.meta.url ) ) ],
			bundle: true,
			minify: true,
			format: 'esm',
			platform: 'node',
			write: false,
		} );
		const moduleUrl = `data:text/javascript;base64,${ Buffer.from( result.outputFiles[ 0 ].text ).toString( 'base64' ) }`;
		const { CSS_SHORTHAND_REPAIR_FACTORY_SOURCE: minified } = await import( moduleUrl );
		const repair = new Function( 'return (' + minified.factorySrc + ')' )()();

		// Nested @media exercises the recursive path through the rule splitter.
		const live = '@media (min-width: 1px) { .foo { font-weight: ; font-family: ; color: red; } }';
		const original = '@media (min-width: 1px) { .foo { font: var(--x); color: red; } }';
		expect( repair( live, original ) ).toContain( '.foo { font: var(--x); color: red; }' );
	} );
} );
