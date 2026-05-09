import { createShapeId } from 'tldraw';
import { describe, expect, it } from 'vitest';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import { createWidgetShape } from './create-widget';

describe( 'createWidgetShape', () => {
	it( 'creates a note widget shape centered on the requested point', () => {
		const createdWidget = createWidgetShape( {
			id: createShapeId( 'note-1' ),
			type: 'note',
			center: {
				x: 400,
				y: 300,
			},
		} );

		expect( createdWidget ).toEqual( {
			shape: {
				id: 'shape:note-1',
				type: RECTANGLE_WIDGET_SHAPE_TYPE,
				x: 300,
				y: 200,
				props: {
					widgetType: 'note',
					shapeProps: {
						w: 200,
						h: 200,
					},
					widgetProps: {
						text: '',
						tone: 'yellow',
					},
				},
			},
			startEditing: true,
		} );
	} );

	it( 'ignores widget types without creation metadata', () => {
		expect(
			createWidgetShape( {
				id: createShapeId( 'unsupported' ),
				type: 'unsupported',
				center: {
					x: 0,
					y: 0,
				},
			} )
		).toBeNull();
	} );
} );
