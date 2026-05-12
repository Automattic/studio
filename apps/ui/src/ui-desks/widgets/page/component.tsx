import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { getPostStatusInfo } from '@/ui-desks/widgets/post-status';
import styles from './style.module.css';
import type { PageWidgetProps } from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type PageWidgetComponentProps = DeskWidgetComponentProps< PageWidgetProps >;
type PageCardRecord = CoreDataPost & {
	status?: string;
	slug?: string;
};

export function PageWidgetComponent( { id, widgetProps }: PageWidgetComponentProps ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.pageId ],
			per_page: 1,
			context: 'edit',
			_fields: 'id,title,excerpt,slug,status',
		} ),
		[ widgetProps.pageId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< PageCardRecord >( 'postType', 'page', query, {
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
	const statusInfo = getPostStatusInfo( record?.status );

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
			{ record?.status && (
				<div className={ styles.metadata }>
					<span className={ styles.status } title={ statusInfo.label }>
						<span
							className={ styles.statusDot }
							style={ { background: statusInfo.color } }
							aria-hidden="true"
						/>
						<span className={ styles.statusLabel }>{ statusInfo.label }</span>
					</span>
				</div>
			) }
			{ slug && <div className={ styles.slug }>/{ slug }</div> }
		</article>
	);
}

function getPageTitle(
	pageRecord: PageCardRecord | null,
	isResolving: boolean,
	hasError: boolean
) {
	if ( pageRecord ) {
		return pageRecord.title?.rendered || __( 'Untitled' );
	}

	if ( hasError ) {
		return __( 'Unable to load page' );
	}

	return isResolving ? __( 'Loading page…' ) : __( 'Page unavailable' );
}
