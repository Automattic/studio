import { __ } from '@wordpress/i18n';
import { update } from '@wordpress/icons';
import { IconControlButton } from '@/ui-desks/components';
import type { EmbedWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function EmbedFitSizeControl( {
	fitSelectedWidgetToContent,
	props,
}: ControlRenderContext< EmbedWidgetProps > ) {
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
