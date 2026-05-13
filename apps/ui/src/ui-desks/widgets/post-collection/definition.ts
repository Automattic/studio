import { store as coreDataStore, type Post as CoreDataPost } from '@wordpress/core-data';
import { __, sprintf } from '@wordpress/i18n';
import { category, post } from '@wordpress/icons';
import { getStackTileLayoutsFromFirstTile } from '@/ui-desks/stacks/utils';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { POST_WIDGET_TYPE, type PostWidget } from '@/ui-desks/widgets/post/types';
import {
	PostCollectionLoadingComponent,
	PostCollectionThumbnailComponent,
	PostCollectionWidgetComponent,
} from '@/ui-desks/widgets/post-collection/component';
import {
	isPostCollectionWidgetProps,
	POST_COLLECTION_WIDGET_TYPE,
	type PostCollectionQuery,
	type PostCollectionWidget,
	type PostCollectionWidgetProps,
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
const STACK_VIEW_MODE_OPTIONS: Array< {
	value: NonNullable< PostCollectionWidgetProps[ 'viewMode' ] >;
	label: string;
} > = [
	{ value: 'stack', label: __( 'Stack' ) },
	{ value: 'tiles', label: __( 'Tiles' ) },
];

export const postCollectionWidgetDefinition = {
	type: POST_COLLECTION_WIDGET_TYPE,
	name: () => __( 'Posts' ),
	Component: PostCollectionWidgetComponent,
	thumbnail: PostCollectionThumbnailComponent,
	loading: PostCollectionLoadingComponent,
	controls: [
		{
			type: 'select',
			id: 'view-mode',
			property: 'viewMode',
			label: __( 'Display' ),
			icon: category,
			defaultValue: 'stack',
			options: STACK_VIEW_MODE_OPTIONS,
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
		edit: () => __( 'Open posts' ),
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
	getSummary: ( widgetProps ) =>
		sprintf(
			/* translators: 1: number of posts, 2: post status. */
			__( '%1$d %2$s posts' ),
			widgetProps.query.perPage,
			widgetProps.query.status
		),
	getEditAction: ( { hasSiteId, hasRunningSite } ) =>
		hasSiteId && hasRunningSite ? { kind: 'site-url', path: '/wp-admin/edit.php' } : null,
	getLoadingShapeProps: () => POST_CARD_SHAPE_PROPS,
	resolver: {
		resolve: async ( widget, context ) => {
			const query = getEntityRecordsQuery( widget.widgetProps.query );
			const posts =
				( await getCoreDataResolvers( context ).getEntityRecords( 'postType', 'post', query ) ) ??
				[];
			const positions = getDerivedPostWidgetPositions( widget, posts.length );

			return {
				identity: {
					query,
					posts,
				},
				widgets: posts.map( ( postRecord, index ) =>
					createDerivedPostWidget( widget, postRecord.id, positions[ index ] )
				),
				stacks: posts.length > 0 ? [ createDerivedPostStack( widget, posts ) ] : [],
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
	position: { x: number; y: number }
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
			x: position.x,
			y: position.y,
			zIndex: collection.zIndex,
			shapeProps: POST_CARD_SHAPE_PROPS,
			widgetProps: {
				postId,
			},
		},
	};
}

function createDerivedPostStack(
	collection: PostCollectionWidget,
	posts: CoreDataPost[]
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
			zIndex: collection.zIndex,
			memberIds: posts.map( ( postRecord ) => `${ collection.id }:post:${ postRecord.id }` ),
			...( collection.widgetProps.viewMode === 'tiles' ? { viewMode: 'tiles' as const } : {} ),
		},
	};
}

function getDerivedPostWidgetPositions( collection: PostCollectionWidget, count: number ) {
	if ( collection.widgetProps.viewMode !== 'tiles' ) {
		return Array.from( { length: count }, () => ( {
			x: collection.x,
			y: collection.y,
		} ) );
	}

	const sizes = Array.from( { length: count }, () => POST_CARD_SHAPE_PROPS );
	return getStackTileLayoutsFromFirstTile( sizes, {
		x: collection.x,
		y: collection.y,
	} ).map( ( layout ) => ( {
		x: layout.x,
		y: layout.y,
	} ) );
}
