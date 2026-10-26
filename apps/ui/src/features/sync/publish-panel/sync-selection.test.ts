import { describe, expect, it } from 'vitest';
import { presetOptions } from './options';
import { checkNodes, localNodes, remoteNodes, syncOptions, updateNodes } from './selection';

describe( 'sync selections', () => {
	it( 'keeps plugin directories as directories while limiting expansion', () => {
		const [ plugin ] = localNodes( [
			{ name: 'hello', path: 'wp-content/plugins/hello', isDirectory: true },
		] );
		expect( plugin.folder ).toBe( true );
		expect( plugin.expandable ).toBe( false );
	} );
	it( 'sends remote backup IDs for selective pull and paths for push', () => {
		const nodes = checkNodes(
			remoteNodes( { theme: { id: 'backup-theme-42', type: 'dir' } }, '/wp-content/themes/' ),
			true
		);
		expect( syncOptions( nodes, false ) ).toEqual( {
			push: { optionsToSync: [ 'themes' ], specificSelectionPaths: [ 'themes/theme' ] },
			pull: { optionsToSync: [ 'paths' ], includePathList: [ 'backup-theme-42' ] },
		} );
	} );
	it( 'marks a parent partially selected without including unselected children', () => {
		const nodes = localNodes( [
			{
				name: 'themes',
				path: 'wp-content/themes',
				isDirectory: true,
				children: [
					{ name: 'one', path: 'wp-content/themes/one', isDirectory: true },
					{ name: 'two', path: 'wp-content/themes/two', isDirectory: true },
				],
			},
		] );
		const updated = updateNodes( nodes, 'wp-content/themes/one', ( node ) => ( {
			...node,
			checked: true,
		} ) );
		expect( updated[ 0 ].indeterminate ).toBe( true );
		expect( syncOptions( updated, true ).push ).toEqual( {
			optionsToSync: [ 'sqls', 'themes' ],
			specificSelectionPaths: [ 'themes/one' ],
		} );
	} );
	it( 'uses full-site transfer only when both categories are selected', () => {
		expect( presetOptions( 'all' ).push ).toEqual( { optionsToSync: [ 'all' ] } );
		expect( presetOptions( 'content' ).push.optionsToSync ).toEqual( [ 'sqls' ] );
	} );
} );
