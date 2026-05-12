import { useEntityRecords, type Comment as CoreDataComment } from '@wordpress/core-data';
import { useMemo } from 'react';

type CommentCountRecord = Pick< CoreDataComment, 'id' >;

export function useCommentCount( postId: number | null ): number {
	const query = useMemo(
		() => ( {
			post: postId ?? 0,
			per_page: 1,
			status: 'approve',
			_fields: 'id',
		} ),
		[ postId ]
	);
	const { totalItems } = useEntityRecords< CommentCountRecord >( 'root', 'comment', query, {
		enabled: Boolean( postId ),
	} );

	return totalItems ?? 0;
}
