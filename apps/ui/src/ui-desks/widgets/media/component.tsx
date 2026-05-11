import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import styles from './style.module.css';
import { MEDIA_WIDGET_TYPE, type MediaWidgetProps } from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type MediaWidgetComponentProps = DeskWidgetComponentProps< MediaWidgetProps >;

export function MediaWidgetComponent( { id, widgetProps, isEditing }: MediaWidgetComponentProps ) {
	const videoRef = useRef< HTMLVideoElement | null >( null );

	const handleMouseEnter = () => {
		if ( widgetProps.mediaKind !== 'video' || ! videoRef.current ) {
			return;
		}

		void videoRef.current.play().catch( () => undefined );
	};

	const handleMouseLeave = () => {
		if ( widgetProps.mediaKind !== 'video' || ! videoRef.current ) {
			return;
		}

		videoRef.current.pause();
		videoRef.current.currentTime = 0;
	};

	return (
		<div
			className={ styles.media }
			data-kind={ widgetProps.mediaKind }
			data-is-editing={ isEditing ? 'true' : 'false' }
			data-studio-desk-widget={ MEDIA_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
			onMouseEnter={ handleMouseEnter }
			onMouseLeave={ handleMouseLeave }
		>
			{ widgetProps.url && widgetProps.mediaKind === 'image' && (
				<img
					className={ styles.image }
					src={ widgetProps.url }
					alt={ widgetProps.alt }
					draggable={ false }
				/>
			) }
			{ widgetProps.url && widgetProps.mediaKind === 'video' && (
				<video
					ref={ videoRef }
					className={ styles.video }
					src={ widgetProps.url }
					muted
					playsInline
					loop
					preload="metadata"
				/>
			) }
			{ ! widgetProps.url && <div className={ styles.empty }>{ __( 'Uploading…' ) }</div> }
			{ ! isEditing && <div className={ styles.shield } aria-hidden="true" /> }
		</div>
	);
}
