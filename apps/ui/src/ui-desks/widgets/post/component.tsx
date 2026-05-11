import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { PostWidgetProps } from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type PostWidgetComponentProps = DeskWidgetComponentProps< PostWidgetProps >;

export function PostWidgetComponent( { id, widgetProps }: PostWidgetComponentProps ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.postId ],
			per_page: 1,
			context: 'view',
			_fields: 'id,title,excerpt',
		} ),
		[ widgetProps.postId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< CoreDataPost >( 'postType', 'post', query, {
		enabled: widgetProps.postId > 0,
	} );
	const record = records?.[ 0 ] ?? null;
	const hasError = resolutionStatus === 'ERROR';
	const isLoading = isResolving && ! record;

	if ( isLoading ) {
		return (
			<article
				className={ styles.post }
				data-is-loading="true"
				data-studio-desk-widget="post"
				data-studio-desk-widget-id={ id }
				aria-busy="true"
			>
				<LoadingPlaceholder text={ __( 'Loading post' ) } />
			</article>
		);
	}

	const title = getPostTitle( record, isResolving, hasError );
	const excerpt = record?.excerpt?.rendered ?? '';

	return (
		<article
			className={ styles.post }
			data-is-loading="false"
			data-studio-desk-widget="post"
			data-studio-desk-widget-id={ id }
		>
			<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: title } } />
			{ excerpt && (
				<div className={ styles.body } dangerouslySetInnerHTML={ { __html: excerpt } } />
			) }
		</article>
	);
}

function getPostTitle( postRecord: CoreDataPost | null, isResolving: boolean, hasError: boolean ) {
	if ( postRecord ) {
		return postRecord.title?.rendered || __( 'Untitled' );
	}

	if ( hasError ) {
		return __( 'Unable to load post' );
	}

	return isResolving ? __( 'Loading post…' ) : __( 'Post unavailable' );
}
