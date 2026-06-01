import { __ } from '@wordpress/i18n';
import { symbol, symbolFilled } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import styles from './style.module.css';
import type { ThemeTemplateWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function ThemeTemplateWidgetComponent( {
	id,
	widgetProps,
}: DeskWidgetComponentProps< ThemeTemplateWidgetProps > ) {
	return (
		<TemplateCard
			id={ id }
			widgetProps={ widgetProps }
			dataWidget="theme-template"
			className={ styles.card }
		/>
	);
}

export function ThemeTemplateWidgetThumbnailComponent( {
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ThemeTemplateWidgetProps > ) {
	return (
		<TemplateCard
			widgetProps={ widgetProps }
			dataWidget="theme-template"
			className={ styles.thumbnail }
		/>
	);
}

function TemplateCard( {
	id,
	widgetProps,
	className,
	dataWidget,
}: {
	id?: string;
	widgetProps: ThemeTemplateWidgetProps;
	className: string;
	dataWidget: string;
} ) {
	const isCustom = widgetProps.source === 'custom';

	return (
		<article
			className={ className }
			data-studio-desk-widget={ dataWidget }
			data-studio-desk-widget-id={ id }
		>
			<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: widgetProps.title } } />
			{ widgetProps.description && (
				<div
					className={ styles.description }
					dangerouslySetInnerHTML={ { __html: widgetProps.description } }
				/>
			) }
			<div className={ styles.footer }>
				<div className={ styles.slug }>{ widgetProps.slug || '—' }</div>
				<span
					className={ styles.sourceIcon }
					data-source={ widgetProps.source }
					aria-label={ isCustom ? __( 'Customised template' ) : __( 'Theme template' ) }
					title={ isCustom ? __( 'Customised template' ) : __( 'Theme template' ) }
				>
					<Icon icon={ isCustom ? symbolFilled : symbol } size={ 24 } />
				</span>
			</div>
		</article>
	);
}
