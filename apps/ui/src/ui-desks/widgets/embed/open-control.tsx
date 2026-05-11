import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { IconControlButton } from '@/ui-desks/components';
import type { EmbedWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function EmbedOpenControl( { props }: ControlRenderContext< EmbedWidgetProps > ) {
	const connector = useConnector();
	const canOpen = Boolean( props.url );

	return (
		<IconControlButton
			icon={ external }
			label={ __( 'Open embed in browser' ) }
			variant="toolbar"
			disabled={ ! canOpen }
			onClick={ () => {
				if ( ! props.url ) {
					return;
				}

				void connector.openExternalUrl( props.url );
			} }
		/>
	);
}
