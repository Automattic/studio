import { afterEach, describe, expect, it } from 'vitest';
import { detectHosts, hostResidue, registerHost, registeredHosts, unregisterHost, HostRegistrationError, type Host } from './host.js';
import '../index.js';

const fixture: Host = {
	id: 'test-host',
	detection: {
		httpSignals: [ { header: 'x-test-host', signal: 'test host header' }, { header: 'server', value: 'testhost', signal: 'test host server header' } ],
		sourceSignals: [ { pattern: /\/\.testhost\/scripts\//, signal: 'test host instrumentation script' } ],
	},
	residue: [ { selector: 'iframe#test-badge', evidence: 'test host badge' } ],
};

afterEach( () => { unregisterHost( 'test-host' ); } );

describe( 'deployment hosts', () => {
	it( 'refuses registrations that cannot be recognized or contribute nothing', () => {
		expect( () => registerHost( { ...fixture, id: '' } ) ).toThrow( HostRegistrationError );
		expect( () => registerHost( { ...fixture, detection: {} } ) ).toThrow( /at least one detection signal/ );
		expect( () => registerHost( { ...fixture, residue: [] } ) ).toThrow( /surfaces it injects/ );
		expect( () => registerHost( { ...fixture, residue: [ { selector: '   ', evidence: 'x' } ] } ) ).toThrow( /bounded CSS selectors/ );
		expect( () => registerHost( { ...fixture, residue: [ { selector: 'iframe', evidence: '' } ] } ) ).toThrow( /carry evidence/ );
		registerHost( fixture );
		expect( () => registerHost( fixture ) ).toThrow( /already registered/ );
	} );

	it( 'recognizes a host by response headers or page source, and reports every signal', () => {
		registerHost( fixture );
		const byHeader = detectHosts( new Headers( { 'x-test-host': '1' } ), '' );
		expect( byHeader ).toEqual( [ expect.objectContaining( { id: 'test-host', evidence: [ 'test host header' ] } ) ] );
		const byValue = detectHosts( new Headers( { server: 'TestHost Edge' } ), '' );
		expect( byValue[ 0 ].evidence ).toEqual( [ 'test host server header' ] );
		expect( detectHosts( new Headers( { server: 'nginx' } ), '' ) ).toEqual( [] );
		const bySource = detectHosts( new Headers(), '<script src="/.testhost/scripts/hud"></script>' );
		expect( bySource[ 0 ].evidence ).toEqual( [ 'test host instrumentation script' ] );
		const both = detectHosts( new Headers( { 'x-test-host': '1' } ), '<script src="/.testhost/scripts/hud"></script>' );
		expect( both[ 0 ].evidence ).toHaveLength( 2 );
		expect( hostResidue( both ) ).toEqual( [ { host: 'test-host', selector: 'iframe#test-badge', evidence: 'test host badge' } ] );
	} );

	it( 'publishes the capability vocabulary as a contract a destination can key on', async () => {
		const { SOURCE_CAPABILITIES, SOURCE_CAPABILITY_VOCABULARY } = await import( '../lib/inspect-rendered.js' );
		expect( SOURCE_CAPABILITY_VOCABULARY ).toBe( 'data-liberation/source-capability-vocabulary/v1' );
		expect( [ ...SOURCE_CAPABILITIES ] ).toEqual( [ 'booking', 'commerce', 'dialogs', 'embeds', 'forms', 'media', 'membership', 'navigation' ] );
		expect( [ ...SOURCE_CAPABILITIES ].sort() ).toEqual( [ ...SOURCE_CAPABILITIES ] );
		expect( new Set( SOURCE_CAPABILITIES ).size ).toBe( SOURCE_CAPABILITIES.length );
	} );

	it( 'ships Netlify badge recognition without claiming anything else about the page', () => {
		const netlify = registeredHosts().find( ( host ) => host.id === 'netlify' );
		expect( netlify ).toBeDefined();
		expect( detectHosts( new Headers( { 'x-nf-request-id': 'abc' } ), '' )[ 0 ]?.id ).toBe( 'netlify' );
		expect( detectHosts( new Headers( { server: 'Netlify' } ), '' )[ 0 ]?.id ).toBe( 'netlify' );
		expect( detectHosts( new Headers(), '<script async src="/.netlify/scripts/hud?variant=public"></script>' )[ 0 ]?.id ).toBe( 'netlify' );
		expect( detectHosts( new Headers(), '<a href="https://example.test/?ref=netlify">Netlify</a>' ) ).toEqual( [] );
		expect( netlify!.residue.map( ( rule ) => rule.selector ) ).toEqual( [ 'iframe#nl-badge-frame' ] );
	} );
} );
