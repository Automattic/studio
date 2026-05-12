import { describe, expect, it, vi } from 'vitest';
import { postCollectionWidgetDefinition } from './definition';
import { POST_COLLECTION_WIDGET_TYPE, type PostCollectionWidget } from './types';
import type { WidgetResolverContext } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
} ) );

describe( 'post collection widget definition', () => {
	it( 'keeps tiled post positions stable when resolving from a persisted first tile anchor', async () => {
		const collection = createPostCollectionWidget( {
			x: 100,
			y: 200,
			widgetProps: {
				viewMode: 'tiles',
			},
		} );

		const initialPositions = await resolvePostCollectionPositions( collection );
		expect( initialPositions[ 0 ] ).toMatchObject( { x: 100, y: 200 } );

		const reloadedCollection = {
			...collection,
			x: initialPositions[ 0 ].x,
			y: initialPositions[ 0 ].y,
		};

		await expect( resolvePostCollectionPositions( reloadedCollection ) ).resolves.toEqual(
			initialPositions
		);
	} );
} );

async function resolvePostCollectionPositions( collection: PostCollectionWidget ) {
	const posts = [ 101, 102, 103, 104, 105 ].map( ( id ) => ( { id } ) );
	const registry = {
		resolveSelect: () => ( {
			getEntityRecords: vi.fn().mockResolvedValue( posts ),
		} ),
	} as unknown as WidgetResolverContext[ 'registry' ];

	const resolution = await postCollectionWidgetDefinition.resolver.resolve( collection, {
		registry,
	} );

	return resolution.widgets.map( ( { widget } ) => ( {
		x: widget.x,
		y: widget.y,
	} ) );
}

type PostCollectionWidgetOverrides = Partial< Omit< PostCollectionWidget, 'widgetProps' > > & {
	widgetProps?: Partial< PostCollectionWidget[ 'widgetProps' ] >;
};

function createPostCollectionWidget(
	overrides: PostCollectionWidgetOverrides = {}
): PostCollectionWidget {
	const widgetProps = {
		query: {
			postType: 'post' as const,
			perPage: 5,
			status: 'publish' as const,
			orderby: 'date' as const,
			order: 'desc' as const,
		},
		...overrides.widgetProps,
	};

	return {
		id: 'collection-1',
		type: POST_COLLECTION_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 1,
			h: 1,
		},
		...overrides,
		widgetProps,
	};
}
