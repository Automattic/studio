import { __ } from '@wordpress/i18n';
import { capturePhoto } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import type { SiteCardWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function SiteCardPreviewControl( {
	props,
	updateProps,
}: ControlRenderContext< SiteCardWidgetProps > ) {
	const { fitSelectedWidgetToContent } = useDesk();

	return (
		<Button
			icon={ capturePhoto }
			label={ props.previewVisible ? __( 'Hide preview' ) : __( 'Show preview' ) }
			variant="quiet"
			size="medium"
			aria-pressed={ props.previewVisible }
			onClick={ () => {
				const nextPreviewVisible = ! props.previewVisible;

				updateProps( {
					previewVisible: nextPreviewVisible,
				} );
				void fitSelectedWidgetToContent();
			} }
		/>
	);
}
