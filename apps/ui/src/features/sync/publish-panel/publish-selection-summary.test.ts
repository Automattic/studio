import { describe, expect, it } from 'vitest';
import { publishSelectionSummary } from './publish-selection-summary';
import type { SyncNode } from './selection';

const nodes = ( selected: string[] ): SyncNode[] =>
	[ 'plugins', 'themes', 'uploads' ].map( ( name ) => ( {
		id: name,
		name,
		path: `wp-content/${ name }`,
		folder: true,
		expandable: true,
		checked: selected.includes( name ),
	} ) );

describe( 'publishSelectionSummary', () => {
	it.each( [
		[ [ 'database' ], 'Database only' ],
		[ [ 'plugins' ], 'Plugins' ],
		[ [ 'themes' ], 'Themes' ],
		[ [ 'uploads' ], 'Uploads' ],
		[ [ 'database', 'plugins' ], 'Database and plugins' ],
		[ [ 'database', 'themes' ], 'Database and themes' ],
		[ [ 'database', 'uploads' ], 'Database and uploads' ],
		[ [ 'plugins', 'themes' ], 'Plugins and themes' ],
		[ [ 'plugins', 'uploads' ], 'Plugins and uploads' ],
		[ [ 'themes', 'uploads' ], 'Themes and uploads' ],
		[ [ 'database', 'plugins', 'themes' ], 'All but uploads' ],
		[ [ 'database', 'plugins', 'uploads' ], 'All but themes' ],
		[ [ 'database', 'themes', 'uploads' ], 'All but plugins' ],
		[ [ 'plugins', 'themes', 'uploads' ], 'Files only' ],
		[ [ 'database', 'plugins', 'themes', 'uploads' ], 'Everything' ],
	] as [ string[], string ][] )( 'summarizes %j as %s', ( selected, expected ) => {
		expect(
			publishSelectionSummary( {
				scope: 'custom',
				nodes: nodes( selected ),
				content: selected.includes( 'database' ),
			} )
		).toBe( expected );
	} );

	it.each( [
		[ 'all', 'Everything' ],
		[ 'files', 'Files only' ],
		[ 'content', 'Database only' ],
	] as const )( 'summarizes the %s preset before files load', ( scope, expected ) => {
		expect( publishSelectionSummary( { scope, nodes: [], content: false } ) ).toBe( expected );
	} );

	it( 'does not claim an entire category when only some of its files are selected', () => {
		const partial = nodes( [] );
		partial[ 0 ].indeterminate = true;
		expect( publishSelectionSummary( { scope: 'custom', nodes: partial, content: false } ) ).toBe(
			'Custom selection'
		);
	} );

	it.each( [
		[ [ 'plugins', 'themes', 'uploads' ], false, 'Files only' ],
		[ [ 'plugins', 'themes' ], true, 'All but uploads' ],
		[ [ 'themes' ], false, 'Themes' ],
	] as [ string[], boolean, string ][] )(
		'summarizes categories when other files are excluded',
		( files, content, expected ) => {
			const selected = [
				...nodes( files ),
				{
					id: 'index',
					name: 'index.php',
					path: 'wp-content/index.php',
					folder: false,
					expandable: false,
					checked: false,
				},
			];
			expect( publishSelectionSummary( { scope: 'custom', nodes: selected, content } ) ).toBe(
				expected
			);
		}
	);

	it( 'accounts for additional files outside the three categories', () => {
		const withOther = [
			...nodes( [ 'plugins', 'themes', 'uploads' ] ),
			{
				id: 'other',
				name: 'index.php',
				path: 'index.php',
				folder: false,
				expandable: false,
				checked: false,
			},
		];
		expect( publishSelectionSummary( { scope: 'custom', nodes: withOther, content: true } ) ).toBe(
			'All but other files'
		);
	} );
} );
