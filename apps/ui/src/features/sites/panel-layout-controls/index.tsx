import { __ } from '@wordpress/i18n';
import { FullscreenIcon, SidebarIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './style.module.css';

export function PanelLayoutControls( {
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
			<div
				className={ styles.fullView }
				data-visible={ showFullView || undefined }
				aria-hidden={ ! showFullView || undefined }
				inert={ ! showFullView }
			>
				<IconButton
					size="icon-sm"
					icon={ <FullscreenIcon inward={ fullscreen } /> }
					label={ fullscreen ? __( 'Show chat' ) : __( 'Expand panel' ) }
					onClick={ () => onFullscreenChange( ! fullscreen ) }
					tooltipSide="bottom"
				/>
			</div>
			<IconButton
				size="icon-sm"
				icon={ <SidebarIcon side="right" /> }
				label={ open ? __( 'Hide panel' ) : __( 'Show panel' ) }
				aria-pressed={ open }
				data-workspace-layout={ ! open ? 'chat' : fullscreen ? 'panel' : 'split' }
				onClick={ () => onOpenChange( ! open ) }
				tooltipSide="bottom"
			/>
		</div>
	);
}
