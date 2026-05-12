import { __ } from '@wordpress/i18n';
import { update } from '@wordpress/icons';
import { IconControlButton } from '@/ui-desks/components';
import type { MediaWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function MediaFitSizeControl( {
	fitSelectedWidgetToContent,
	props,
}: ControlRenderContext< MediaWidgetProps > ) {
	return (
		<IconControlButton
			icon={ update }
			label={ __( 'Fit to size' ) }
			variant="toolbar"
			disabled={ ! fitSelectedWidgetToContent || ! props.url }
			onClick={ () => {
				void fitSelectedWidgetToContent?.();
			} }
		/>
	);
}
