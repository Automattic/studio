import { store as coreDataStore, type Post as CoreDataPost } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { post } from '@wordpress/icons';
import { getIndicesAbove, type TLShapePartial } from 'tldraw';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { POST_WIDGET_TYPE, type PostWidget } from '@/ui-desks/widgets/post/types';
import {
	PostCollectionLoadingComponent,
	PostCollectionWidgetComponent,
} from '@/ui-desks/widgets/post-collection/component';
import { PostCollectionEditControl } from '@/ui-desks/widgets/post-collection/edit-control';
import {
	isPostCollectionWidgetProps,
	POST_COLLECTION_WIDGET_TYPE,
	type PostCollectionQuery,
	type PostCollectionWidget,
} from './types';
import type {
	ResolvedDeskStack,
	ResolvedDeskWidget,
	WidgetDefinition,
	WidgetResolverContext,
} from '@/ui-desks/widgets/types';

type EntityRecordsQuery = {
	per_page: number;
	status: 'publish' | 'draft' | Array< 'publish' | 'draft' >;
	orderby: PostCollectionQuery[ 'orderby' ];
	order: PostCollectionQuery[ 'order' ];
	context: 'view' | 'edit';
	_fields: string;
};

type CoreDataPostSelectors = {
	getEntityRecords: (
		kind: 'postType',
		name: 'post',
		query: EntityRecordsQuery
	) => CoreDataPost[] | null;
};

type CoreDataPostResolvers = {
	getEntityRecords: (
		kind: 'postType',
		name: 'post',
		query: EntityRecordsQuery
	) => Promise< CoreDataPost[] | null >;
};

type PostCollectionResolutionIdentity = {
	query: EntityRecordsQuery;
	posts: CoreDataPost[] | null;
};

const COLLECTION_SOURCE_SHAPE_PROPS = {
	w: 1,
	h: 1,
};
const POST_CARD_SHAPE_PROPS = postWidgetDefinition.getInitialWidget().shapeProps;

export const postCollectionWidgetDefinition = {
	type: POST_COLLECTION_WIDGET_TYPE,
	Component: PostCollectionWidgetComponent,
	loading: PostCollectionLoadingComponent,
	controls: [
		{
			type: 'custom',
			id: 'open-posts',
			Component: PostCollectionEditControl,
		},
	],
	requiresRunningSite: true,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isPostCollectionWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 0,
		stroke: 'transparent',
	} ),
	labels: {
		add: () => __( 'New posts collection' ),
	},
	icon: post,
	getInitialWidget: () => ( {
		shapeProps: COLLECTION_SOURCE_SHAPE_PROPS,
		widgetProps: {
			query: {
				postType: 'post',
				perPage: 5,
				status: 'publish',
				orderby: 'date',
				order: 'desc',
			},
		},
	} ),
	getLoadingShapeProps: () => POST_CARD_SHAPE_PROPS,
	resolver: {
		resolve: async ( widget, context ) => {
			const query = getEntityRecordsQuery( widget.widgetProps.query );
			const posts =
				( await getCoreDataResolvers( context ).getEntityRecords( 'postType', 'post', query ) ) ??
				[];
			const zIndices = getDerivedZIndices( widget.zIndex, posts.length + 1 );

			return {
				identity: {
					query,
					posts,
				},
				widgets: posts.map( ( postRecord, index ) =>
					createDerivedPostWidget( widget, postRecord.id, zIndices[ index ] )
				),
				stacks:
					posts.length > 0
						? [ createDerivedPostStack( widget, posts, zIndices[ posts.length ] ) ]
						: [],
			};
		},
		invalidate: ( widget, previousIdentity, context ) => {
			const previous = previousIdentity as PostCollectionResolutionIdentity;
			const query = getEntityRecordsQuery( widget.widgetProps.query );
			if ( JSON.stringify( query ) !== JSON.stringify( previous.query ) ) {
				return true;
			}

			const posts = getCoreDataSelectors( context ).getEntityRecords( 'postType', 'post', query );
			return posts !== previous.posts;
		},
	},
} satisfies WidgetDefinition< PostCollectionWidget >;

function getCoreDataSelectors( { registry }: WidgetResolverContext ): CoreDataPostSelectors {
	return registry.select( coreDataStore ) as unknown as CoreDataPostSelectors;
}

function getCoreDataResolvers( { registry }: WidgetResolverContext ): CoreDataPostResolvers {
	return registry.resolveSelect( coreDataStore ) as unknown as CoreDataPostResolvers;
}

function getEntityRecordsQuery( query: PostCollectionQuery ): EntityRecordsQuery {
	const canIncludeDrafts = query.status === 'draft' || query.status === 'any';
	return {
		per_page: query.perPage,
		status: query.status === 'any' ? [ 'publish', 'draft' ] : query.status,
		orderby: query.orderby,
		order: query.order,
		context: canIncludeDrafts ? 'edit' : 'view',
		_fields: 'id',
	};
}

function createDerivedPostWidget(
	collection: PostCollectionWidget,
	postId: number,
	zIndex: string
): ResolvedDeskWidget< PostWidget > {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: collection.id,
			key: `post:${ postId }`,
		},
		widget: {
			id: `${ collection.id }:post:${ postId }`,
			type: POST_WIDGET_TYPE,
			x: collection.x,
			y: collection.y,
			zIndex,
			shapeProps: POST_CARD_SHAPE_PROPS,
			widgetProps: {
				postId,
			},
		},
	};
}

function createDerivedPostStack(
	collection: PostCollectionWidget,
	posts: CoreDataPost[],
	zIndex: string
): ResolvedDeskStack {
	return {
		origin: {
			kind: 'derived',
			sourceWidgetId: collection.id,
			key: 'posts',
		},
		stack: {
			id: `post-collection:${ collection.id }`,
			x: collection.x,
			y: collection.y,
			zIndex,
			memberIds: posts.map( ( postRecord ) => `${ collection.id }:post:${ postRecord.id }` ),
		},
	};
}

function getDerivedZIndices( zIndex: string, count: number ) {
	return getIndicesAbove( zIndex as TLShapePartial[ 'index' ], count ) as string[];
}
