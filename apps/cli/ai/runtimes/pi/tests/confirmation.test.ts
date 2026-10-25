import { describe, expect, it, vi } from 'vitest';
import { createConfirmer, describeDestructiveCall } from '../confirmation';

describe( 'describeDestructiveCall', () => {
	it( 'names the target and consequence of syncs and deletions', () => {
		expect(
			describeDestructiveCall( 'site_push', { nameOrPath: 'shop', remoteSite: 'shop.com' } )
		).toEqual( {
			question: 'Push the local site "shop" to shop.com?',
			consequence: "Replaces shop.com's all content with the local site's.",
		} );
		expect(
			describeDestructiveCall( 'site_pull', { nameOrPath: 'shop', remoteSite: '1' } )
		).toBeTruthy();
		expect(
			describeDestructiveCall( 'site_delete', { nameOrPath: 'shop', deleteFiles: false } )
				?.consequence
		).toBe( 'Removes it from Studio and keeps its files.' );
		expect(
			describeDestructiveCall( 'preview_delete', { host: 'p.wordpress.com' } )?.question
		).toBe( 'Delete the preview site p.wordpress.com?' );
	} );

	it( 'confirms backups that replace a site, not WXR imports that add to it', () => {
		expect( describeDestructiveCall( 'site_import', { importFile: '/b/site.zip' } ) ).toBeTruthy();
		expect(
			describeDestructiveCall( 'site_import', { importFile: '/b/export.xml' } )
		).toBeUndefined();
	} );
} );

describe( 'createConfirmer', () => {
	const push = { nameOrPath: 'shop', remoteSite: 'shop.com' };
	const question = 'Push the local site "shop" to shop.com?';

	it( 'runs the call once the user confirms', async () => {
		const ask = vi.fn().mockResolvedValue( { [ question ]: 'Yes, go ahead' } );
		expect(
			await createConfirmer( ask )( describeDestructiveCall( 'site_push', push ) )
		).toBeUndefined();
		expect( ask.mock.calls[ 0 ][ 0 ][ 0 ] ).toMatchObject( { question, allowFreeForm: false } );
	} );

	it( 'reports the answer when the user declines', async () => {
		const ask = vi.fn().mockResolvedValue( { [ question ]: 'No' } );
		expect( await createConfirmer( ask )( describeDestructiveCall( 'site_push', push ) ) ).toBe(
			`Not run: the user answered "No" to: ${ question }`
		);
	} );

	// A call whose No has a consequence of its own says it, to the user and on the refusal.
	it.each( [
		{
			name: 'the user declines',
			ask: vi.fn().mockResolvedValue( { 'Make "yoga" a classic theme?': 'No' } ),
			refusal:
				'Not run: the user answered "No" to: Make "yoga" a classic theme? It is a block theme.',
		},
		{
			name: 'the session cannot ask',
			ask: undefined,
			refusal:
				'Not run: Make "yoga" a classic theme? needs the user\'s confirmation, and this session cannot ask for it. It is a block theme.',
		},
	] )( 'says what follows from No when $name', async ( { ask, refusal } ) => {
		const call = {
			question: 'Make "yoga" a classic theme?',
			consequence: 'PHP templates.',
			declined: 'It is a block theme.',
		};
		expect( await createConfirmer( ask )( call ) ).toBe( refusal );
		if ( ask ) {
			expect( ask.mock.calls[ 0 ][ 0 ][ 0 ].options[ 1 ] ).toEqual( {
				label: 'No',
				description: 'It is a block theme.',
			} );
		}
	} );

	it( 'does not ask about other calls', async () => {
		const ask = vi.fn();
		expect(
			await createConfirmer( ask )( describeDestructiveCall( 'Read', { path: 'x' } ) )
		).toBeUndefined();
		expect( ask ).not.toHaveBeenCalled();
	} );

	it( 'does not run the call when the session cannot ask', async () => {
		expect(
			await createConfirmer( undefined )( describeDestructiveCall( 'site_push', push ) )
		).toContain( 'cannot ask for it' );
	} );

	it( 'asks one question at a time', async () => {
		let open = 0;
		let maxOpen = 0;
		const ask = vi.fn( async ( questions: { question: string }[] ) => {
			maxOpen = Math.max( maxOpen, ++open );
			await new Promise( ( resolve ) => setTimeout( resolve, 5 ) );
			open--;
			return { [ questions[ 0 ].question ]: 'Yes, go ahead' };
		} );
		const confirm = createConfirmer( ask );
		await Promise.all( [
			confirm( describeDestructiveCall( 'site_delete', { nameOrPath: 'a' } ) ),
			confirm( describeDestructiveCall( 'site_delete', { nameOrPath: 'b' } ) ),
		] );
		expect( ask ).toHaveBeenCalledTimes( 2 );
		expect( maxOpen ).toBe( 1 );
	} );
} );
