import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { Button } from '@/ui-desks/components';
import type { MediaWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function MediaOpenControl( { props }: ControlRenderContext< MediaWidgetProps > ) {
	const connector = useConnector();
	const canOpen = Boolean( props.url );

	return (
		<Button
			icon={ external }
			label={ __( 'Open media in browser' ) }
			variant="quiet"
			size="medium"
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
