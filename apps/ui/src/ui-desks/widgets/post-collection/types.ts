import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskStackViewMode, DeskWidgetBase } from '@studio/common/types/desk';

export const POST_COLLECTION_WIDGET_TYPE = 'post-collection';

export type PostCollectionStatus = 'publish' | 'draft' | 'any';
export type PostCollectionOrderBy = 'date' | 'modified' | 'title';
export type PostCollectionOrder = 'asc' | 'desc';

export type PostCollectionQuery = {
	postType: 'post';
	perPage: number;
	status: PostCollectionStatus;
	orderby: PostCollectionOrderBy;
	order: PostCollectionOrder;
};

export type PostCollectionWidgetProps = {
	query: PostCollectionQuery;
	viewMode?: DeskStackViewMode;
};

export type PostCollectionWidget = DeskWidgetBase<
	typeof POST_COLLECTION_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	PostCollectionWidgetProps
>;

export function isPostCollectionWidgetProps( value: unknown ): value is PostCollectionWidgetProps {
	const candidate = value as Partial< PostCollectionWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		isPostCollectionQuery( candidate.query ) &&
		isPostCollectionViewMode( candidate.viewMode )
	);
}

function isPostCollectionViewMode( value: unknown ): value is DeskStackViewMode | undefined {
	return value === undefined || value === 'stack' || value === 'tiles';
}

function isPostCollectionQuery( value: unknown ): value is PostCollectionQuery {
	const candidate = value as Partial< PostCollectionQuery >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		candidate.postType === 'post' &&
		typeof candidate.perPage === 'number' &&
		Number.isInteger( candidate.perPage ) &&
		candidate.perPage >= 1 &&
		candidate.perPage <= 20 &&
		( candidate.status === 'publish' ||
			candidate.status === 'draft' ||
			candidate.status === 'any' ) &&
		( candidate.orderby === 'date' ||
			candidate.orderby === 'modified' ||
			candidate.orderby === 'title' ) &&
		( candidate.order === 'asc' || candidate.order === 'desc' )
	);
}
