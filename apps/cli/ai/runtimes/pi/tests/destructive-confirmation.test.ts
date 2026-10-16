import { describe, expect, it, vi } from 'vitest';
import { createDestructiveConfirmer, describeDestructiveCall } from '../destructive-confirmation';

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

	it( 'confirms only DELETE requests to WordPress.com', () => {
		expect(
			describeDestructiveCall( 'wpcom_request', { method: 'DELETE', path: '/posts/4', siteId: 9 } )
				?.question
		).toBe( 'Send DELETE /posts/4 to WordPress.com site 9?' );
		expect(
			describeDestructiveCall( 'wpcom_request', { method: 'POST', path: '/plugins/x', siteId: 9 } )
		).toBeUndefined();
	} );

	it.each( [
		'plugin delete akismet',
		'theme delete twentytwenty',
		'user delete 2 --reassign=1',
		'term delete category 4',
		'option delete my_option',
		'post delete 12 --force',
		'site empty --yes',
		'search-replace old.test new.test',
		'wp db reset --yes',
	] )( 'confirms the irreversible WP-CLI command "%s"', ( command ) => {
		expect( describeDestructiveCall( 'wp_cli', { nameOrPath: 's', command } ) ).toBeTruthy();
	} );

	it.each( [
		'post delete 12',
		'comment delete 3',
		'plugin deactivate akismet',
		'search-replace old.test new.test --dry-run',
		'option get blogname',
		'post list --post_type=page',
	] )( 'runs the recoverable WP-CLI command "%s" without asking', ( command ) => {
		expect( describeDestructiveCall( 'wp_cli', { nameOrPath: 's', command } ) ).toBeUndefined();
	} );
} );

describe( 'createDestructiveConfirmer', () => {
	const push = { nameOrPath: 'shop', remoteSite: 'shop.com' };
	const question = 'Push the local site "shop" to shop.com?';

	it( 'runs the call once the user confirms', async () => {
		const ask = vi.fn().mockResolvedValue( { [ question ]: 'Yes, go ahead' } );
		expect( await createDestructiveConfirmer( ask )( 'site_push', push ) ).toBeUndefined();
		expect( ask.mock.calls[ 0 ][ 0 ][ 0 ] ).toMatchObject( { question, allowFreeForm: false } );
	} );

	it( 'reports the answer when the user declines', async () => {
		const ask = vi.fn().mockResolvedValue( { [ question ]: 'No' } );
		expect( await createDestructiveConfirmer( ask )( 'site_push', push ) ).toBe(
			`Not run: the user answered "No" to: ${ question }`
		);
	} );

	it( 'does not ask about other calls', async () => {
		const ask = vi.fn();
		expect( await createDestructiveConfirmer( ask )( 'Read', { path: 'x' } ) ).toBeUndefined();
		expect( ask ).not.toHaveBeenCalled();
	} );

	it( 'does not run the call when the session cannot ask', async () => {
		expect( await createDestructiveConfirmer( undefined )( 'site_push', push ) ).toContain(
			'cannot ask for it'
		);
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
		const confirm = createDestructiveConfirmer( ask );
		await Promise.all( [
			confirm( 'site_delete', { nameOrPath: 'a' } ),
			confirm( 'site_delete', { nameOrPath: 'b' } ),
		] );
		expect( ask ).toHaveBeenCalledTimes( 2 );
		expect( maxOpen ).toBe( 1 );
	} );
} );
