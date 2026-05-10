import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { PageWidgetProps } from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type PageWidgetComponentProps = DeskWidgetComponentProps< PageWidgetProps >;

export function PageWidgetComponent( { id, widgetProps }: PageWidgetComponentProps ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.pageId ],
			per_page: 1,
			context: 'view',
			_fields: 'id,title,excerpt,slug',
		} ),
		[ widgetProps.pageId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< CoreDataPost >( 'postType', 'page', query, {
		enabled: widgetProps.pageId > 0,
	} );
	const record = records?.[ 0 ] ?? null;
	const hasError = resolutionStatus === 'ERROR';
	const isLoading = isResolving && ! record;

	if ( isLoading ) {
		return (
			<article
				className={ styles.page }
				data-tone={ widgetProps.tone }
				data-is-loading="true"
				data-studio-desk-widget="page"
				data-studio-desk-widget-id={ id }
				aria-busy="true"
			>
				<LoadingPlaceholder text={ __( 'Loading page' ) } />
			</article>
		);
	}

	const title = getPageTitle( record, isResolving, hasError );
	const excerpt = record?.excerpt?.rendered ?? '';
	const slug = record?.slug ?? '';

	return (
		<article
			className={ styles.page }
			data-tone={ widgetProps.tone }
			data-is-loading="false"
			data-studio-desk-widget="page"
			data-studio-desk-widget-id={ id }
		>
			<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: title } } />
			{ excerpt && (
				<div className={ styles.body } dangerouslySetInnerHTML={ { __html: excerpt } } />
			) }
			{ slug && <div className={ styles.slug }>/{ slug }</div> }
		</article>
	);
}

function getPageTitle( pageRecord: CoreDataPost | null, isResolving: boolean, hasError: boolean ) {
	if ( pageRecord ) {
		return pageRecord.title?.rendered || __( 'Untitled' );
	}

	if ( hasError ) {
		return __( 'Unable to load page' );
	}

	return isResolving ? __( 'Loading page…' ) : __( 'Page unavailable' );
}
