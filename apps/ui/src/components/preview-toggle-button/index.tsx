import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { usePreviewBeside } from '@/components/preview-split-frame';
import { useOptionalSessionPreviewUI } from '@/hooks/use-session-ui';
import { closeIcon, drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

/**
 * The header control for the chat/preview split: hides the chat while the
 * preview sits beside it, or brings back a preview that was closed (a window
 * too narrow for both closes it). Renders nothing outside the dashboard layout.
 */
export function PreviewToggleButton( { canHideChat = false }: { canHideChat?: boolean } ) {
	const preview = useOptionalSessionPreviewUI();
	const previewBeside = usePreviewBeside();

	if ( ! preview ) {
		return null;
	}
	if ( previewBeside ) {
		return canHideChat ? (
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				className="studio-control"
				icon={ closeIcon }
				label={ __( 'Hide chat' ) }
				onClick={ () => preview.setChatHidden( true ) }
			/>
		) : null;
	}
	return preview.open ? null : (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			className={ clsx( styles.showPreview, 'studio-control' ) }
			icon={ drawerIcon }
			label={ __( 'Show preview' ) }
			onClick={ () => preview.setOpen( true ) }
		/>
	);
}
