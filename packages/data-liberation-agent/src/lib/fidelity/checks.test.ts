import { afterEach, describe, expect, it } from 'vitest';
import {
	fidelityCheckNames,
	findFidelityCheck,
	registerFidelityCheck,
	runFidelityChecks,
	unregisterFidelityCheck,
	type FidelityCheckContext,
} from './checks.js';
import type { LayoutObservation } from './score.js';

const observation = ( extra: Partial< LayoutObservation > = {} ): LayoutObservation => ( {
	viewport: 1600,
	title: 'Home',
	textChars: 10,
	widestImage: 1600,
	images: [],
	docWidth: 1600,
	overflow: false,
	externalHosts: [],
	hashTargets: [],
	internalMissing: [],
	dialogs: [],
	...extra,
} );

const context = ( extra: Partial< FidelityCheckContext > = {} ): FidelityCheckContext => ( {
	route: '/',
	viewport: 1600,
	sourceUrl: 'https://example.com/',
	candidateUrl: 'http://127.0.0.1:1234/',
	source: observation(),
	candidate: observation(),
	evidenceDir: '/tmp/evidence',
	...extra,
} );

afterEach( () => {
	for ( const name of fidelityCheckNames() ) {
		if ( name !== 'core' ) unregisterFidelityCheck( name );
	}
} );

describe( 'the check registry', () => {
	it( 'ships the built-in comparison registered through the public API', () => {
		expect( fidelityCheckNames() ).toContain( 'core' );
		expect( findFidelityCheck( 'core' ) ).not.toBeNull();
	} );

	it( 'refuses a duplicate name unless replacement is explicit', () => {
		registerFidelityCheck( { name: 'visual', run: () => ( {} ) } );
		expect( () => registerFidelityCheck( { name: 'visual', run: () => ( {} ) } ) ).toThrow(
			/already registered/
		);
		expect( () =>
			registerFidelityCheck( { name: 'visual', run: () => ( {} ) }, { replace: true } )
		).not.toThrow();
	} );

	it( 'needs a name', () => {
		expect( () => registerFidelityCheck( { name: '   ', run: () => ( {} ) } ) ).toThrow(
			/needs a name/
		);
	} );

	it( 'lets a consumer replace the built-in comparison entirely', async () => {
		const builtIn = findFidelityCheck( 'core' )!;
		try {
			registerFidelityCheck(
				{ name: 'core', run: () => ( { failures: [ 'my own rules' ] } ) },
				{ replace: true }
			);
			expect( ( await runFidelityChecks( context() ) ).failures ).toEqual( [ 'my own rules' ] );
		} finally {
			// The registry is process-wide state, so a test that swaps the
			// built-in has to put it back or it leaks into every later run.
			registerFidelityCheck( builtIn, { replace: true } );
		}
	} );
} );

describe( 'runFidelityChecks', () => {
	it( 'merges failures, notes and artifacts across checks', async () => {
		registerFidelityCheck( {
			name: 'visual',
			run: () => ( {
				failures: [ 'hero moved 40px' ],
				notes: [ 'mismatch 0.031' ],
				artifacts: [ '/tmp/evidence/diff.png' ],
			} ),
		} );

		const result = await runFidelityChecks( context() );
		expect( result.failures ).toContain( 'hero moved 40px' );
		expect( result.notes ).toContain( 'mismatch 0.031' );
		expect( result.artifacts ).toEqual( [ '/tmp/evidence/diff.png' ] );
	} );

	it( 'awaits an async check, so a harness can shell out', async () => {
		registerFidelityCheck( {
			name: 'sandboxed',
			run: async () => {
				await new Promise( ( resolve ) => setTimeout( resolve, 5 ) );
				return { notes: [ 'ran out of process' ] };
			},
		} );
		expect( ( await runFidelityChecks( context() ) ).notes ).toContain( 'ran out of process' );
	} );

	it( 'gives a check the target pair, not only the observations', async () => {
		let seen: FidelityCheckContext | null = null;
		registerFidelityCheck( {
			name: 'records-context',
			run: ( ctx ) => {
				seen = ctx;
				return {};
			},
		} );

		await runFidelityChecks( context() );
		expect( seen! ).toMatchObject( {
			route: '/',
			viewport: 1600,
			sourceUrl: 'https://example.com/',
			candidateUrl: 'http://127.0.0.1:1234/',
			evidenceDir: '/tmp/evidence',
		} );
	} );

	it( 'reports a throwing check as a failure instead of losing the rest of the gate', async () => {
		registerFidelityCheck( {
			name: 'broken',
			run: () => {
				throw new Error( 'sandbox unavailable' );
			},
		} );
		registerFidelityCheck( { name: 'still-runs', run: () => ( { notes: [ 'unaffected' ] } ) } );

		const result = await runFidelityChecks( context() );
		expect( result.failures.some( ( f ) => /"broken" failed to run: sandbox unavailable/.test( f ) ) ).toBe(
			true
		);
		expect( result.notes ).toContain( 'unaffected' );
	} );

	it( 'runs the built-in against the observation pair', async () => {
		const result = await runFidelityChecks(
			context( { candidate: observation( { textChars: 400 } ) } )
		);
		expect( result.failures.some( ( f ) => /text 400 chars/.test( f ) ) ).toBe( true );
	} );
} );
