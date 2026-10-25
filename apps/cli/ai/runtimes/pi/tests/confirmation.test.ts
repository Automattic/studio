import { mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
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

describe( 'the category plan', async () => {
	const dir = await mkdtemp( path.join( os.tmpdir(), 'studio-category-plan-' ) );
	const suggestions = path.join( dir, 'suggestions.json' );
	const categories = path.join( dir, 'categories.json' );
	await writeFile(
		suggestions,
		JSON.stringify( [
			{ post_id: 1, cats: [ 'a' ] },
			{ post_id: 2, cats: [ 'b' ] },
		] )
	);
	await writeFile( categories, JSON.stringify( [ { slug: 'a', name: 'A' } ] ) );
	const script = 'wp eval-file tmp/taxonomist/apply-changes.php';

	it.each( [
		{
			tool: 'Bash',
			command: `${ script } suggestions=${ suggestions } categories=${ categories } mode=apply`,
			consequence:
				'Creates or updates 1 category, and sets the categories of 2 posts, logging each change. The backup taken before the analysis restores them.',
		},
		{
			tool: 'wp_cli',
			command: `eval-file tmp/taxonomist/apply-changes.php mode=apply suggestions="${ suggestions }"`,
			consequence:
				'Sets the categories of 2 posts, logging each change. The backup taken before the analysis restores them.',
		},
		{
			tool: 'Bash',
			command: `${ script } suggestions=/missing.json mode=apply`,
			consequence:
				'Sets the categories of every post in the plan, logging each change. The backup taken before the analysis restores them.',
		},
		{ tool: 'Bash', command: `${ script } suggestions=${ suggestions }`, consequence: undefined },
		{
			tool: 'Bash',
			command: `${ script } suggestions=${ suggestions } mode=preview`,
			consequence: undefined,
		},
		{
			tool: 'Bash',
			command: 'wp eval-file tmp/taxonomist/backup.php mode=apply',
			consequence: undefined,
		},
	] )( 'asks before $tool runs: $command', ( { tool, command, consequence } ) => {
		expect( describeDestructiveCall( tool, { command } )?.consequence ).toBe( consequence );
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
		expect( await createConfirmer( ask )( describeDestructiveCall( 'site_push', push ) ) ).toEqual(
			{ text: `Not run: the user answered "No" to: ${ question }` }
		);
	} );

	// A question the user closes hands the turn back to them, rather than reading as No.
	it.each( [ {}, { [ question ]: '' }, { [ question ]: ' ' } ] )(
		'ends the turn when the user closes the question: %j',
		async ( answers ) => {
			const ask = vi.fn().mockResolvedValue( answers );
			expect(
				await createConfirmer( ask )( describeDestructiveCall( 'site_push', push ) )
			).toEqual( {
				text: `Not run: The user closed without answering: ${ question } The turn ends here, and the user replies when ready.`,
				endsTurn: true,
			} );
		}
	);

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
		expect( await createConfirmer( ask )( call ) ).toEqual( { text: refusal } );
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
		).toMatchObject( { text: expect.stringContaining( 'cannot ask for it' ) } );
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
