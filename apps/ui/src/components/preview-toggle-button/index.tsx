import { __ } from '@wordpress/i18n';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { useOptionalSessionPreviewUI } from '@/hooks/use-session-ui';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

/**
 * Bottom-toolbar button that shows/hides the site preview panel. Shared by
 * the chat footer and the site overview footer so the control looks and
 * behaves identically everywhere. Renders nothing outside the dashboard
 * layout (no SessionUIProvider hosting a preview panel).
 */
export function PreviewToggleButton() {
	const preview = useOptionalSessionPreviewUI();

	if ( ! preview ) {
		return null;
	}

	const label = preview.open ? __( 'Hide preview' ) : __( 'Show preview' );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.button }
						aria-label={ label }
						onClick={ preview.toggle }
					/>
				}
			>
				<Icon icon={ drawerIcon } size={ 26 } className={ styles.icon } />
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}
