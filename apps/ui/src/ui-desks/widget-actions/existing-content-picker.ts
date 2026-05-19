import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { CONTENT_CARD_STATUSES, getPostStatusInfo } from './post-status';

export type ExistingContentType = 'post' | 'page';

export interface ExistingContentPickerItem {
	id: number;
	title: string;
	status?: string;
	statusInfo: ReturnType< typeof getPostStatusInfo >;
}

export function useExistingContentPicker( {
	type,
	siteId,
}: {
	type: ExistingContentType;
	siteId?: string;
} ) {
	const { data: sites, isLoading: isLoadingSites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const canQueryContent = Boolean( site?.running );
	const query = useMemo(
		() => ( {
			per_page: 20,
			context: 'edit',
			status: CONTENT_CARD_STATUSES,
			orderby: type === 'page' ? 'menu_order' : 'date',
			order: type === 'page' ? 'asc' : 'desc',
			_fields: 'id,title,excerpt,status,date,link,slug',
		} ),
		[ type ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< CoreDataPost >( 'postType', type, query, {
		enabled: canQueryContent,
	} );
	const items = useMemo(
		() =>
			records?.map( ( record ) => {
				const status = record.status;
				return {
					id: record.id,
					title: decodeEntities( record.title?.rendered ?? '' ).trim() || __( 'Untitled' ),
					status,
					statusInfo: getPostStatusInfo( status ),
				};
			} ),
		[ records ]
	);
	const statusMessage = getExistingContentPickerStatusMessage( {
		type,
		isLoadingSites,
		hasSite: Boolean( site ),
		canQueryContent,
		isResolving,
		hasRecords: Boolean( records ),
		itemCount: items?.length,
		resolutionStatus,
	} );

	return {
		items,
		isLoadingSites,
		site,
		canQueryContent,
		isResolving,
		resolutionStatus,
		statusMessage,
	};
}

export function getExistingContentWidgetType( type: ExistingContentType ) {
	return type === 'page' ? PAGE_WIDGET_TYPE : POST_WIDGET_TYPE;
}

export function getExistingContentWidgetProps( type: ExistingContentType, id: number ) {
	return type === 'page' ? { pageId: id, tone: 'neutral' } : { postId: id };
}

function getExistingContentPickerStatusMessage( {
	type,
	isLoadingSites,
	hasSite,
	canQueryContent,
	isResolving,
	hasRecords,
	itemCount,
	resolutionStatus,
}: {
	type: ExistingContentType;
	isLoadingSites: boolean;
	hasSite: boolean;
	canQueryContent: boolean;
	isResolving: boolean;
	hasRecords: boolean;
	itemCount: number | undefined;
	resolutionStatus: string;
} ) {
	if ( isLoadingSites ) {
		return __( 'Checking site…' );
	}

	if ( ! hasSite ) {
		return __( 'Site not found.' );
	}

	if ( ! canQueryContent ) {
		return __( 'Site is not running.' );
	}

	if ( isResolving && ! hasRecords ) {
		return type === 'page' ? __( 'Loading pages…' ) : __( 'Loading posts…' );
	}

	if ( itemCount === 0 ) {
		return type === 'page' ? __( 'No pages found.' ) : __( 'No posts found.' );
	}

	if ( resolutionStatus === 'ERROR' ) {
		return type === 'page' ? __( 'Unable to load pages.' ) : __( 'Unable to load posts.' );
	}

	return undefined;
}
