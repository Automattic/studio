import { describe, expect, it } from 'vitest';
import { buildInspectorPageScript } from '../page-script';
import {
	buildInspectorCommandScript,
	INSPECTOR_BRIDGE_PREFIX,
	parseInspectorGuestEvent,
} from '../protocol';

const FEATURES = {
	elementClips: true,
	regionClips: true,
	pageClips: true,
	loupe: true,
	contextMenu: true,
	browserShortcuts: true,
	submitToolbar: false,
};

describe( 'buildInspectorPageScript', () => {
	it( 'produces a syntactically valid, self-contained program', () => {
		const script = buildInspectorPageScript( { features: FEATURES } );
		// Parse without executing: the script targets a browser DOM.
		expect( () => new Function( script ) ).not.toThrow();
	} );

	it( 'embeds the injected config, not module references', () => {
		const script = buildInspectorPageScript( { features: FEATURES, initialZoom: 4 } );
		expect( script ).toContain( '"initialZoom":4' );
		expect( script ).toContain( JSON.stringify( INSPECTOR_BRIDGE_PREFIX ) );
		// The serialized function must not close over imports.
		expect( script ).not.toContain( 'import ' );
		expect( script ).not.toContain( 'require(' );
	} );
} );

describe( 'parseInspectorGuestEvent', () => {
	it( 'parses prefixed JSON console lines', () => {
		expect(
			parseInspectorGuestEvent( `${ INSPECTOR_BRIDGE_PREFIX }{"type":"clip-page"}` )
		).toEqual( { type: 'clip-page' } );
	} );

	it( 'ignores ordinary console output and malformed payloads', () => {
		expect( parseInspectorGuestEvent( 'plain log line' ) ).toBeNull();
		expect( parseInspectorGuestEvent( `${ INSPECTOR_BRIDGE_PREFIX }not-json` ) ).toBeNull();
		expect( parseInspectorGuestEvent( `${ INSPECTOR_BRIDGE_PREFIX }{"noType":true}` ) ).toBeNull();
	} );
} );

describe( 'buildInspectorCommandScript', () => {
	it( 'serializes a dispatchable command statement', () => {
		const script = buildInspectorCommandScript( { type: 'layer-toggle' } );
		expect( script ).toContain( 'dispatchEvent' );
		expect( script ).toContain( '"layer-toggle"' );
		expect( () => new Function( script ) ).not.toThrow();
	} );
} );
