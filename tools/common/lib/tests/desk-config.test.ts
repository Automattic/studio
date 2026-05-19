import { assertDeskConfig, isDeskConfig } from '../desk-config';

const validDesk = {
	version: 1,
	updatedAt: '2026-05-14T00:00:00.000Z',
	viewport: {
		x: 0,
		y: 0,
		z: 1,
	},
	widgets: [
		{
			id: 'note-1',
			type: 'note',
			x: 10,
			y: 20,
			zIndex: 'a1',
			shapeProps: {
				w: 240,
				h: 180,
			},
			widgetProps: {
				content: 'Hello',
			},
		},
		{
			id: 'note-2',
			type: 'note',
			x: 320,
			y: 20,
			zIndex: 'a2',
			shapeProps: {},
			widgetProps: {},
		},
	],
	stacks: [
		{
			id: 'stack-1',
			x: 10,
			y: 20,
			zIndex: 'a3',
			memberIds: [ 'note-1', 'note-2' ],
			viewMode: 'tiles',
		},
	],
	connectors: [
		{
			id: 'connector-1',
			from: {
				widgetId: 'note-1',
				normalizedAnchor: { x: 1, y: 0.5 },
			},
			to: {
				widgetId: 'note-2',
				normalizedAnchor: { x: 0, y: 0.5 },
			},
			bend: 72,
		},
	],
};

describe( 'desk config validation', () => {
	it( 'accepts a structurally valid desk config', () => {
		expect( isDeskConfig( validDesk ) ).toBe( true );
		expect( () => assertDeskConfig( validDesk ) ).not.toThrow();
	} );

	it( 'accepts circular stack view modes', () => {
		expect(
			isDeskConfig( {
				...validDesk,
				stacks: [ { ...validDesk.stacks[ 0 ], viewMode: 'circle' } ],
			} )
		).toBe( true );
	} );

	it( 'rejects unsupported desk config versions', () => {
		expect( () => assertDeskConfig( { ...validDesk, version: 999 } ) ).toThrow(
			'Invalid desk config: expected version 1.'
		);
	} );

	it( 'rejects invalid widget records', () => {
		expect(
			isDeskConfig( {
				...validDesk,
				widgets: [ { ...validDesk.widgets[ 0 ], shapeProps: [] } ],
			} )
		).toBe( false );
	} );

	it( 'rejects invalid stack view modes', () => {
		expect(
			isDeskConfig( {
				...validDesk,
				stacks: [ { ...validDesk.stacks[ 0 ], viewMode: 'grid' } ],
			} )
		).toBe( false );
	} );

	it( 'rejects connector anchors outside the normalized range', () => {
		expect(
			isDeskConfig( {
				...validDesk,
				connectors: [
					{
						...validDesk.connectors[ 0 ],
						from: {
							...validDesk.connectors[ 0 ].from,
							normalizedAnchor: { x: 1.5, y: 0.5 },
						},
					},
				],
			} )
		).toBe( false );
	} );
} );
