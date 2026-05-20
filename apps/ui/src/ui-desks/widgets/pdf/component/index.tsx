import { useResizeObserver } from '@wordpress/compose';
import { __ } from '@wordpress/i18n';
import { file } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useState } from 'react';
import { PDF_WIDGET_TYPE, type PdfWidgetProps } from '../types';
import {
	chromelessPdfUrl,
	formatPdfBytes,
	PDF_DEFAULT_HEIGHT,
	PDF_DEFAULT_WIDTH,
	PDF_PREVIEW_THRESHOLD,
} from '../utils';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type PdfWidgetComponentProps = DeskWidgetComponentProps< PdfWidgetProps >;

export function PdfWidgetComponent( { id, widgetProps }: PdfWidgetComponentProps ) {
	const [ size, setSize ] = useState( {
		w: PDF_DEFAULT_WIDTH,
		h: PDF_DEFAULT_HEIGHT,
	} );
	const observeSize = useResizeObserver< HTMLDivElement >( ( entries ) => {
		const entry = entries[ 0 ];
		if ( ! entry ) {
			return;
		}

		setSize( {
			w: entry.contentRect.width,
			h: entry.contentRect.height,
		} );
	} );
	const isPreview = size.w >= PDF_PREVIEW_THRESHOLD && size.h >= PDF_PREVIEW_THRESHOLD;
	const title = widgetProps.title || __( 'PDF' );
	const sizeLabel =
		typeof widgetProps.filesize === 'number' ? formatPdfBytes( widgetProps.filesize ) : null;

	return (
		<div
			ref={ observeSize }
			data-studio-desk-widget={ PDF_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
			className={ styles.container }
		>
			{ isPreview ? (
				<div className={ styles.preview }>
					{ widgetProps.url ? (
						<iframe
							className={ styles.iframe }
							src={ chromelessPdfUrl( widgetProps.url ) }
							title={ title }
						/>
					) : (
						<span className={ styles.previewEmpty }>{ __( 'No PDF source' ) }</span>
					) }
				</div>
			) : (
				<div className={ styles.card }>
					<span className={ styles.badge } aria-hidden="true">
						<Icon icon={ file } size={ 20 } />
						<span className={ styles.badgeLabel }>{ __( 'PDF' ) }</span>
					</span>
					<div className={ styles.body }>
						<div className={ styles.title } title={ title }>
							{ title }
						</div>
						{ sizeLabel && <div className={ styles.meta }>{ sizeLabel }</div> }
					</div>
				</div>
			) }
		</div>
	);
}

export function PdfWidgetThumbnailComponent( {
	id,
}: DeskWidgetThumbnailComponentProps< PdfWidgetProps > ) {
	return (
		<div
			className={ styles.contextThumbnail }
			data-studio-desk-widget={ PDF_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
			title={ __( 'PDF' ) }
		>
			<span className={ styles.contextThumbnailBadge } aria-hidden="true">
				<Icon icon={ file } size={ 20 } />
				<span className={ styles.contextThumbnailLabel }>{ __( 'PDF' ) }</span>
			</span>
		</div>
	);
}
