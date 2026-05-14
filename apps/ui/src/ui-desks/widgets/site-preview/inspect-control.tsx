import { __ } from '@wordpress/i18n';
import { search } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';

export function SitePreviewInspectControl() {
	const { editSelectedWidget } = useDesk();

	return (
		<Button
			icon={ search }
			label={ __( 'Inspect (enter preview)' ) }
			variant="quiet"
			size="medium"
			onClick={ editSelectedWidget }
		/>
	);
}
