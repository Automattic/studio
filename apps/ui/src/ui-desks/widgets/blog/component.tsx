import styles from '@/ui-desks/widgets/page/style.module.css';
import type { BlogWidgetProps } from './types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type BlogWidgetComponentProps = DeskWidgetComponentProps< BlogWidgetProps >;

export function BlogWidgetComponent( { id, widgetProps }: BlogWidgetComponentProps ) {
	const slug = formatSlug( widgetProps.slug );

	return (
		<article
			className={ styles.page }
			data-tone="violet"
			data-is-loading="false"
			data-studio-desk-widget="blog"
			data-studio-desk-widget-id={ id }
		>
			<h2 className={ styles.title }>{ widgetProps.title }</h2>
			{ slug && <div className={ styles.slug }>{ slug }</div> }
		</article>
	);
}

export function BlogWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< BlogWidgetProps > ) {
	const slug = formatSlug( widgetProps.slug );

	return (
		<article
			className={ styles.contextThumbnail }
			data-tone="violet"
			data-studio-desk-widget="blog"
			data-studio-desk-widget-id={ id }
		>
			<div className={ styles.contextThumbnailTitle }>{ widgetProps.title }</div>
			{ slug && <div className={ styles.contextThumbnailSlug }>{ slug }</div> }
		</article>
	);
}

function formatSlug( slug: string | undefined ) {
	if ( ! slug ) {
		return '';
	}

	const trimmedSlug = slug.replace( /^\/+|\/+$/g, '' );
	return trimmedSlug ? `/${ trimmedSlug }` : '/';
}
