import { __ } from '@wordpress/i18n';
import { capturePhoto } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_CARD_WIDGET_TYPE, type SiteCardWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

const SITE_CARD_BODY_HEIGHT = 200;
const SITE_CARD_PREVIEW_HEIGHT = 240;
const SITE_CARD_WITH_PREVIEW_HEIGHT = SITE_CARD_BODY_HEIGHT + SITE_CARD_PREVIEW_HEIGHT;

export function SiteCardPreviewControl( {
	props,
	updateProps,
}: ControlRenderContext< SiteCardWidgetProps > ) {
	const { selectedWidgetToolbarItem, updateSelectedWidgetShapeProps } = useDesk();
	const widget =
		selectedWidgetToolbarItem?.kind === 'single-widget' &&
		selectedWidgetToolbarItem.widget.type === SITE_CARD_WIDGET_TYPE
			? selectedWidgetToolbarItem.widget
			: null;

	return (
		<Button
			icon={ capturePhoto }
			label={ props.previewVisible ? __( 'Hide preview' ) : __( 'Show preview' ) }
			variant="quiet"
			size="medium"
			aria-pressed={ props.previewVisible }
			onClick={ () => {
				const nextPreviewVisible = ! props.previewVisible;
				const currentHeight =
					widget && typeof widget.shapeProps.h === 'number'
						? widget.shapeProps.h
						: SITE_CARD_BODY_HEIGHT;
				const nextHeight = nextPreviewVisible
					? Math.max( currentHeight, SITE_CARD_WITH_PREVIEW_HEIGHT )
					: currentHeight <= SITE_CARD_WITH_PREVIEW_HEIGHT + 4
					? SITE_CARD_BODY_HEIGHT
					: currentHeight;

				updateProps( {
					previewVisible: nextPreviewVisible,
				} );
				if ( nextHeight !== currentHeight ) {
					updateSelectedWidgetShapeProps( { h: nextHeight } );
				}
			} }
		/>
	);
}
