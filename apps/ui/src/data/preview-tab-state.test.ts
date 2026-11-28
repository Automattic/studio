import { expect, it } from 'vitest';
import {
	closePreviewTabs,
	getPreviewTabGroups,
	addPreviewTabToSplit,
	selectPreviewTab,
	type PreviewTabWorkspace,
} from './preview-tab-state';

const workspace = (): PreviewTabWorkspace => ( {
	tabs: [ 'a', 'b', 'c', 'd' ].map( ( id ) => ( { id, path: `/${ id }/`, title: id } ) ),
	selectedId: 'a',
	focusRequest: 0,
	recentIds: [ 'a', 'c', 'b', 'd' ],
	splits: [],
} );

it( 'uses the most recent other tab when the selected tab is split', () => {
	const result = addPreviewTabToSplit( workspace(), 'a' );
	expect( result.splits[ 0 ].tabIds ).toEqual( [ 'c', 'a' ] );
	expect( result.selectedId ).toBe( 'a' );
	expect( result.tabs.map( ( tab ) => tab.id ) ).toEqual( [ 'b', 'c', 'a', 'd' ] );
} );

it( 'appends a pane to the selected split and preserves the remaining tabs', () => {
	const first = addPreviewTabToSplit( workspace(), 'b' );
	const second = addPreviewTabToSplit( selectPreviewTab( first, 'c' ), 'd' );
	const replaced = addPreviewTabToSplit( selectPreviewTab( second, 'b' ), 'c' );
	expect( replaced.splits.map( ( split ) => split.tabIds ) ).toEqual( [ [ 'a', 'b', 'c' ] ] );
	expect( new Set( replaced.tabs.map( ( tab ) => tab.id ) ) ).toEqual(
		new Set( [ 'a', 'b', 'c', 'd' ] )
	);
	expect(
		getPreviewTabGroups( replaced ).map( ( group ) => group.map( ( tab ) => tab.id ) )
	).toEqual( [ [ 'a', 'b', 'c' ], [ 'd' ] ] );
} );

it( 'creates a regular blank tab when the last pair is closed', () => {
	const paired = addPreviewTabToSplit( workspace(), 'b' );
	const result = closePreviewTabs( paired, [ 'a', 'b', 'c', 'd' ], 'replacement' );
	expect( result.tabs ).toEqual( [ { id: 'replacement', path: null, title: null } ] );
	expect( result.splits ).toEqual( [] );
	expect( result.recentIds ).toEqual( [ 'replacement' ] );
} );

it.each( [ 'start', 'end' ] as const )(
	'inserts at the %s of a split while preserving existing pane weights',
	( position ) => {
		const current = addPreviewTabToSplit( workspace(), 'b' );
		current.splits[ 0 ].weights = [ 0.25, 0.75 ];
		const result = addPreviewTabToSplit( current, 'c', undefined, position );
		const ids = position === 'start' ? [ 'c', 'a', 'b' ] : [ 'a', 'b', 'c' ];
		expect( result.splits[ 0 ].tabIds ).toEqual( ids );
		expect( result.splits[ 0 ].weights ).toEqual(
			position === 'start' ? [ 0.5, 0.25, 0.75 ] : [ 0.25, 0.75, 0.5 ]
		);
		expect( result.tabs.map( ( tab ) => tab.id ) ).toEqual( [ ...ids, 'd' ] );
	}
);
