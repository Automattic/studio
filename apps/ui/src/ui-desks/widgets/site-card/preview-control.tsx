import { __ } from '@wordpress/i18n';
import { capturePhoto } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
import type { SiteCardWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function SiteCardPreviewControl( {
	props,
	updateProps,
}: ControlRenderContext< SiteCardWidgetProps > ) {
	return (
		<Button
			icon={ capturePhoto }
			label={ props.previewVisible ? __( 'Hide inline preview' ) : __( 'Show inline preview' ) }
			variant="quiet"
			size="medium"
			aria-pressed={ props.previewVisible }
			onClick={ () =>
				updateProps( {
					previewVisible: ! props.previewVisible,
				} )
			}
		/>
	);
}
