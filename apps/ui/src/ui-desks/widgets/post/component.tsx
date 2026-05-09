import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { getRenderedText } from '@/data/wordpress/html';
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
			_fields: 'id,title,excerpt,status,date,link',
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

	const title = getPostTitle( record, isResolving, hasError );
	const excerpt = getRenderedText( record?.excerpt );
	const status = record?.status;
	const date = getFormattedDate( record?.date );

	return (
		<article
			className={ styles.post }
			data-is-loading={ isResolving && ! record ? 'true' : 'false' }
			data-studio-desk-widget="post"
			data-studio-desk-widget-id={ id }
		>
			<div className={ styles.meta }>
				<span className={ styles.type }>{ __( 'Post' ) }</span>
				{ status && <span className={ styles.status }>{ status }</span> }
			</div>
			<h2 className={ styles.title }>{ title }</h2>
			{ excerpt && <p className={ styles.excerpt }>{ excerpt }</p> }
			{ date && <time className={ styles.date }>{ date }</time> }
		</article>
	);
}

function getPostTitle( postRecord: CoreDataPost | null, isResolving: boolean, hasError: boolean ) {
	if ( postRecord ) {
		return getRenderedText( postRecord.title ) || __( 'Untitled' );
	}

	if ( hasError ) {
		return __( 'Unable to load post' );
	}

	return isResolving ? __( 'Loading post…' ) : __( 'Post unavailable' );
}

function getFormattedDate( date: string | null | undefined ) {
	if ( ! date ) {
		return '';
	}

	const parsedDate = new Date( date );
	if ( Number.isNaN( parsedDate.getTime() ) ) {
		return '';
	}

	return new Intl.DateTimeFormat( undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	} ).format( parsedDate );
}
