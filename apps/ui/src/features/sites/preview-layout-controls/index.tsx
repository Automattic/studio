import { __ } from '@wordpress/i18n';
import { Maximize2, Minimize2 } from 'lucide-react';
import { SidebarIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './style.module.css';

export function PreviewLayoutControls( {
	open,
	showFullView,
	onOpenChange,
	fullscreen,
	onFullscreenChange,
}: {
	open: boolean;
	showFullView: boolean;
	onOpenChange: ( open: boolean ) => void;
	fullscreen: boolean;
	onFullscreenChange: ( fullscreen: boolean ) => void;
} ) {
	return (
		<div className={ styles.controls }>
			{ showFullView ? (
				<IconButton
					size="icon-sm"
					icon={ fullscreen ? <Minimize2 /> : <Maximize2 /> }
					label={ fullscreen ? __( 'Exit full view' ) : __( 'Enter full view' ) }
					onClick={ () => onFullscreenChange( ! fullscreen ) }
					tooltipSide="bottom"
				/>
			) : null }
			<IconButton
				size="icon-sm"
				icon={ <SidebarIcon side="right" /> }
				label={ open ? __( 'Hide preview' ) : __( 'Show preview' ) }
				aria-pressed={ open }
				data-preview-layout={ ! open ? 'chat' : fullscreen ? 'preview' : 'split' }
				onClick={ () => onOpenChange( ! open ) }
				tooltipSide="bottom"
			/>
		</div>
	);
}
