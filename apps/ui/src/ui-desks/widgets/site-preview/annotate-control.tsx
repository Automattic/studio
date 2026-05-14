import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import { createShapeId } from 'tldraw';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_PREVIEW_WIDGET_TYPE } from './types';

export function SitePreviewAnnotateControl() {
	const { selectedWidgetToolbarItem, startAnnotatingPreview } = useDesk();
	const widget =
		selectedWidgetToolbarItem?.kind === 'single-widget' &&
		selectedWidgetToolbarItem.widget.type === SITE_PREVIEW_WIDGET_TYPE
			? selectedWidgetToolbarItem.widget
			: null;

	return (
		<Button
			icon={ pencil }
			label={ __( 'Annotate' ) }
			variant="quiet"
			size="medium"
			disabled={ ! widget }
			onClick={ () => {
				if ( widget ) {
					startAnnotatingPreview( createShapeId( widget.id ) );
				}
			} }
		/>
	);
}
