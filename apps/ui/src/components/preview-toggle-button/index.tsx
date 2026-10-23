import { __ } from '@wordpress/i18n';
import { PanelRightIcon, XIcon } from 'lucide-react';
import { usePreviewBeside } from '@/components/preview-split-frame';
import { IconButton } from '@/components/ui/button';
import { useOptionalSessionPreviewUI } from '@/hooks/use-session-ui';
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
				icon={ <XIcon /> }
				label={ __( 'Hide chat' ) }
				onClick={ () => preview.setChatHidden( true ) }
			/>
		) : null;
	}
	return preview.open ? null : (
		<IconButton
			className={ styles.showPreview }
			icon={ <PanelRightIcon /> }
			label={ __( 'Show preview' ) }
			onClick={ () => preview.setOpen( true ) }
		/>
	);
}
