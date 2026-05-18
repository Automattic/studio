import { __ } from '@wordpress/i18n';
import { seen } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider/context';
import type { PostWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function PostPreviewControl( { props }: ControlRenderContext< PostWidgetProps > ) {
	const { canPreviewContentInSitePreview, previewContentInSitePreview } = useDesk();

	return (
		<Button
			icon={ seen }
			label={ __( 'Preview on canvas' ) }
			variant="quiet"
			size="medium"
			disabled={ props.postId <= 0 || ! canPreviewContentInSitePreview }
			onClick={ () => {
				void previewContentInSitePreview( 'post', props.postId );
			} }
		/>
	);
}
