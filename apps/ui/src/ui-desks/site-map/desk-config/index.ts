import { getIndicesAbove } from 'tldraw';
import { DESK_CONFIG_VERSION, type DeskConfig, type DeskConnector } from '@/ui-desks/desk/types';
import { BLOG_WIDGET_TYPE, type BlogWidget } from '@/ui-desks/widgets/blog/types';
import { PAGE_WIDGET_TYPE, type PageTone, type PageWidget } from '@/ui-desks/widgets/page/types';
import {
	POST_COLLECTION_WIDGET_TYPE,
	type PostCollectionWidget,
} from '@/ui-desks/widgets/post-collection/types';

export interface SiteMapPage {
	id: number;
	parent?: number | null;
	menu_order?: number;
	slug?: string;
	title?: {
		rendered?: string;
	};
}

export interface SiteMapSettings {
	show_on_front?: string;
	page_on_front?: number;
	page_for_posts?: number;
}

type SiteMapLayoutNode = {
	id: number;
	kind: 'page' | 'blog';
	parent: number;
	menu_order: number;
	slug?: string;
	title?: {
		rendered?: string;
	};
};

const BLOG_NODE_ID = -1;
const BLOG_WIDGET_ID = 'site-map-blog';
const POST_COLLECTION_WIDGET_ID = 'site-map-post-collection';
const PAGE_WIDTH = 280;
const PAGE_HEIGHT = 380;
const COLUMN_GAP = 96;
const ROW_GAP = 136;
const STATIC_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export const emptySiteMapDeskConfig: DeskConfig = {
	version: DESK_CONFIG_VERSION,
	updatedAt: STATIC_UPDATED_AT,
	widgets: [],
};

export function createSiteMapDeskConfig(
	pages: SiteMapPage[],
	settings?: SiteMapSettings | null
): DeskConfig {
	const layoutNodes = createLayoutNodes( normalizePages( pages ), settings );
	if ( layoutNodes.length === 0 ) {
		return emptySiteMapDeskConfig;
	}

	const positions = layoutPages( layoutNodes );
	const zIndices = getIndicesAbove( null, layoutNodes.length + 1 );
	const widgets = layoutNodes
		.map( ( node, index ) => createNodeWidget( node, positions, zIndices[ index ] ) )
		.filter( ( widget ): widget is PageWidget | BlogWidget => widget !== null );

	if ( widgets.length === 0 ) {
		return emptySiteMapDeskConfig;
	}

	const postCollection = createPostCollectionWidget( positions, zIndices[ widgets.length ] );
	const connectors = createConnectors( layoutNodes );

	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: STATIC_UPDATED_AT,
		widgets: [ ...widgets, postCollection ],
		...( connectors.length > 0 ? { connectors } : {} ),
	};
}

export function getSiteMapDeskConfigSignature(
	pages: SiteMapPage[] | null | undefined,
	settings?: SiteMapSettings | null
) {
	const settingsSignature = [
		settings?.show_on_front ?? '',
		settings?.page_on_front ?? 0,
		settings?.page_for_posts ?? 0,
	].join( ':' );
	const pagesSignature = normalizePages( pages ?? [] )
		.map(
			( page ) =>
				`${ page.id }:${ page.parent ?? 0 }:${ page.menu_order ?? 0 }:${
					page.slug ?? ''
				}:${ getPageTitle( page ) }`
		)
		.join( '|' );

	return `${ settingsSignature }|${ pagesSignature }`;
}

function createNodeWidget(
	node: SiteMapLayoutNode,
	positions: Map< number, { x: number; y: number } >,
	zIndex: string
): PageWidget | BlogWidget | null {
	const position = positions.get( node.id );
	if ( ! position ) {
		return null;
	}

	if ( node.kind === 'blog' ) {
		return createBlogWidget( node, position, zIndex );
	}

	return {
		id: getNodeWidgetId( node ),
		type: PAGE_WIDGET_TYPE,
		x: position.x,
		y: position.y,
		zIndex,
		shapeProps: {
			w: PAGE_WIDTH,
			h: PAGE_HEIGHT,
		},
		widgetProps: {
			pageId: node.id,
			tone: getPageTone( node ),
		},
	};
}

function createBlogWidget(
	node: SiteMapLayoutNode,
	position: { x: number; y: number },
	zIndex: string
): BlogWidget {
	return {
		id: BLOG_WIDGET_ID,
		type: BLOG_WIDGET_TYPE,
		x: position.x,
		y: position.y,
		zIndex,
		shapeProps: {
			w: PAGE_WIDTH,
			h: PAGE_HEIGHT,
		},
		widgetProps: {
			title: 'Blog',
			...( node.slug ? { slug: node.slug } : {} ),
		},
	};
}

function createPostCollectionWidget(
	positions: Map< number, { x: number; y: number } >,
	zIndex: string
): PostCollectionWidget {
	const origin = getPostCollectionOrigin( positions );

	return {
		id: POST_COLLECTION_WIDGET_ID,
		type: POST_COLLECTION_WIDGET_TYPE,
		x: origin.x,
		y: origin.y,
		zIndex,
		shapeProps: {
			w: PAGE_WIDTH,
			h: PAGE_HEIGHT,
		},
		widgetProps: {
			query: {
				postType: 'post',
				perPage: 5,
				status: 'publish',
				orderby: 'date',
				order: 'desc',
			},
		},
	};
}

function createLayoutNodes( pages: SiteMapPage[], settings?: SiteMapSettings | null ) {
	const blogNode = createBlogNode( pages, settings );
	const droppedPostsPageId =
		blogNode && settings?.show_on_front === 'page' ? getExistingPostsPageId( pages, settings ) : 0;
	const homeNodeId = getHomeNodeId( pages, settings );
	const nodes: SiteMapLayoutNode[] = [];

	if ( blogNode ) {
		nodes.push( blogNode );
	}

	for ( const page of pages ) {
		if ( page.id === droppedPostsPageId ) {
			continue;
		}

		nodes.push( {
			id: page.id,
			kind: 'page',
			parent: getLayoutPageParent( page, droppedPostsPageId, homeNodeId ),
			menu_order: page.menu_order ?? 0,
			slug: page.slug,
			title: page.title,
		} );
	}

	return repairMissingParents( nodes ).sort( compareNodes );
}

function createBlogNode(
	pages: SiteMapPage[],
	settings?: SiteMapSettings | null
): SiteMapLayoutNode | null {
	if ( ! settings?.show_on_front ) {
		return null;
	}

	if ( isPostsHome( settings ) ) {
		return {
			id: BLOG_NODE_ID,
			kind: 'blog',
			parent: 0,
			menu_order: -1,
			title: { rendered: 'Blog' },
		};
	}

	const postsPageId = getExistingPostsPageId( pages, settings );
	const postsPage = postsPageId ? pages.find( ( page ) => page.id === postsPageId ) : undefined;
	if ( postsPage ) {
		return {
			id: BLOG_NODE_ID,
			kind: 'blog',
			parent: getBlogParentId( pages, settings, postsPage ),
			menu_order: postsPage.menu_order ?? 0,
			slug: postsPage.slug,
			title: { rendered: 'Blog' },
		};
	}

	return {
		id: BLOG_NODE_ID,
		kind: 'blog',
		parent: getStaticFrontPageId( pages, settings ) ?? 0,
		menu_order: Number.MAX_SAFE_INTEGER,
		slug: 'blog',
		title: { rendered: 'Blog' },
	};
}

function getLayoutPageParent(
	page: SiteMapPage,
	droppedPostsPageId: number,
	homeNodeId: number | null
) {
	const parentId = page.parent ?? 0;
	if ( page.id === homeNodeId ) {
		return 0;
	}

	if ( droppedPostsPageId !== 0 && parentId === droppedPostsPageId ) {
		return BLOG_NODE_ID;
	}

	return parentId === 0 && homeNodeId !== null ? homeNodeId : parentId;
}

function getHomeNodeId( pages: SiteMapPage[], settings?: SiteMapSettings | null ) {
	if ( isPostsHome( settings ) ) {
		return BLOG_NODE_ID;
	}

	if ( settings?.show_on_front === 'page' ) {
		return getStaticFrontPageId( pages, settings );
	}

	return null;
}

function getExistingPostsPageId( pages: SiteMapPage[], settings: SiteMapSettings ) {
	const postsPageId = getPositiveId( settings.page_for_posts );
	return postsPageId && pages.some( ( page ) => page.id === postsPageId ) ? postsPageId : 0;
}

function getBlogParentId(
	pages: SiteMapPage[],
	settings: SiteMapSettings,
	postsPage: SiteMapPage
) {
	const staticFrontPageId = getStaticFrontPageId( pages, settings );
	const parentId = postsPage.parent ?? 0;
	return parentId === 0 && staticFrontPageId ? staticFrontPageId : parentId;
}

function getStaticFrontPageId( pages: SiteMapPage[], settings: SiteMapSettings ) {
	const staticFrontPageId = getPositiveId( settings.page_on_front );
	return staticFrontPageId && pages.some( ( page ) => page.id === staticFrontPageId )
		? staticFrontPageId
		: null;
}

function repairMissingParents( nodes: SiteMapLayoutNode[] ) {
	const nodeIds = new Set( nodes.map( ( node ) => node.id ) );
	return nodes.map( ( node ) =>
		node.parent !== 0 && ! nodeIds.has( node.parent ) ? { ...node, parent: 0 } : node
	);
}

function createConnectors( nodes: SiteMapLayoutNode[] ): DeskConnector[] {
	const widgetIdsByNodeId = new Map(
		nodes.map( ( node ) => [ node.id, getNodeWidgetId( node ) ] )
	);
	const connectors = nodes.flatMap( ( node ): DeskConnector[] => {
		if ( node.parent === 0 ) {
			return [];
		}

		const parentWidgetId = widgetIdsByNodeId.get( node.parent );
		const childWidgetId = widgetIdsByNodeId.get( node.id );
		if ( ! parentWidgetId || ! childWidgetId ) {
			return [];
		}

		return [
			{
				id: `${ parentWidgetId }-to-${ childWidgetId }`,
				from: {
					widgetId: parentWidgetId,
					normalizedAnchor: { x: 0.5, y: 1 },
				},
				to: {
					widgetId: childWidgetId,
					normalizedAnchor: { x: 0.5, y: 0 },
				},
				bend: 24,
			},
		];
	} );

	if ( widgetIdsByNodeId.has( BLOG_NODE_ID ) ) {
		connectors.push( {
			id: `${ BLOG_WIDGET_ID }-to-${ POST_COLLECTION_WIDGET_ID }`,
			from: {
				widgetId: BLOG_WIDGET_ID,
				normalizedAnchor: { x: 1, y: 0.5 },
			},
			to: {
				widgetId: POST_COLLECTION_WIDGET_ID,
				normalizedAnchor: { x: 0, y: 0.5 },
			},
			bend: 24,
		} );
	}

	return connectors;
}

function normalizePages( pages: SiteMapPage[] ) {
	const pagesById = new Map< number, SiteMapPage >();

	for ( const page of pages ) {
		if ( Number.isInteger( page.id ) && page.id > 0 ) {
			pagesById.set( page.id, page );
		}
	}

	const knownIds = new Set( pagesById.keys() );
	return Array.from( pagesById.values() )
		.map( ( page ) => ( {
			...page,
			parent: normalizeParentId( page, knownIds ),
			menu_order: page.menu_order ?? 0,
		} ) )
		.sort( comparePages );
}

function normalizeParentId( page: SiteMapPage, knownIds: Set< number > ) {
	const parentId = page.parent ?? 0;
	if ( parentId === page.id || parentId <= 0 || ! knownIds.has( parentId ) ) {
		return 0;
	}

	return parentId;
}

function layoutPages( nodes: SiteMapLayoutNode[] ) {
	const childrenByParent = new Map< number, SiteMapLayoutNode[] >();
	const positions = new Map< number, { x: number; y: number } >();
	const placedIds = new Set< number >();

	for ( const node of nodes ) {
		childrenByParent.set( node.parent, [ ...( childrenByParent.get( node.parent ) ?? [] ), node ] );
	}
	for ( const children of childrenByParent.values() ) {
		children.sort( compareNodes );
	}

	let cursor = 0;
	for ( const root of childrenByParent.get( 0 ) ?? [] ) {
		cursor += placePage( root, 0, cursor, new Set() ) + COLUMN_GAP;
	}

	for ( const node of nodes ) {
		if ( ! placedIds.has( node.id ) ) {
			cursor += placePage( node, 0, cursor, new Set() ) + COLUMN_GAP;
		}
	}

	return positions;

	function placePage( node: SiteMapLayoutNode, depth: number, leftX: number, path: Set< number > ) {
		if ( placedIds.has( node.id ) || path.has( node.id ) ) {
			return 0;
		}

		const nextPath = new Set( path );
		nextPath.add( node.id );
		const children = getSafeChildren( node.id, nextPath );
		const widthInLeaves = Math.max( 1, getLeafCount( node.id, path ) );
		const width = widthInLeaves * ( PAGE_WIDTH + COLUMN_GAP ) - COLUMN_GAP;

		positions.set( node.id, {
			x: leftX + width / 2 - PAGE_WIDTH / 2,
			y: depth * ( PAGE_HEIGHT + ROW_GAP ),
		} );
		placedIds.add( node.id );

		let childCursor = leftX;
		for ( const child of children ) {
			const childWidth = placePage( child, depth + 1, childCursor, nextPath );
			childCursor += childWidth + COLUMN_GAP;
		}

		return width;
	}

	function getLeafCount( nodeId: number, path: Set< number > ): number {
		if ( path.has( nodeId ) ) {
			return 1;
		}

		const nextPath = new Set( path );
		nextPath.add( nodeId );
		const children = getSafeChildren( nodeId, nextPath );
		if ( children.length === 0 ) {
			return 1;
		}

		return children.reduce( ( count, child ) => count + getLeafCount( child.id, nextPath ), 0 );
	}

	function getSafeChildren( parentId: number, path: Set< number > ) {
		return ( childrenByParent.get( parentId ) ?? [] ).filter(
			( child ) => ! path.has( child.id ) && ! placedIds.has( child.id )
		);
	}
}

function getPageTone( node: SiteMapLayoutNode ): PageTone {
	return node.parent === 0 ? 'sky' : 'neutral';
}

function getPostCollectionOrigin( positions: Map< number, { x: number; y: number } > ) {
	const pagePositions = Array.from( positions.values() );
	const rightEdge = Math.max( ...pagePositions.map( ( position ) => position.x ) ) + PAGE_WIDTH;
	const blogPosition = positions.get( BLOG_NODE_ID );

	return {
		x: Math.max(
			( blogPosition?.x ?? 0 ) + PAGE_WIDTH + COLUMN_GAP * 2,
			rightEdge + COLUMN_GAP * 2
		),
		y: blogPosition?.y ?? Math.min( ...pagePositions.map( ( position ) => position.y ) ),
	};
}

function getNodeWidgetId( node: SiteMapLayoutNode ) {
	return node.kind === 'blog' ? BLOG_WIDGET_ID : `site-map-page-${ node.id }`;
}

function isPostsHome( settings?: SiteMapSettings | null ) {
	return settings?.show_on_front === 'posts';
}

function getPositiveId( value: number | undefined ) {
	return typeof value === 'number' && Number.isInteger( value ) && value > 0 ? value : 0;
}

function compareNodes( first: SiteMapLayoutNode, second: SiteMapLayoutNode ) {
	return (
		( first.menu_order ?? 0 ) - ( second.menu_order ?? 0 ) ||
		getNodeTitle( first ).localeCompare( getNodeTitle( second ) ) ||
		first.id - second.id
	);
}

function comparePages( first: SiteMapPage, second: SiteMapPage ) {
	return (
		( first.menu_order ?? 0 ) - ( second.menu_order ?? 0 ) ||
		getPageTitle( first ).localeCompare( getPageTitle( second ) ) ||
		first.id - second.id
	);
}

function getNodeTitle( node: SiteMapLayoutNode ) {
	return node.title?.rendered ?? '';
}

function getPageTitle( page: SiteMapPage ) {
	return page.title?.rendered ?? '';
}
