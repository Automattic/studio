import { __ } from '@wordpress/i18n';
import { comment, download, globe, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';

const drawerIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
		<line x1="9.5" y1="5" x2="9.5" y2="19" stroke="currentColor" strokeWidth="1.5" />
	</svg>
);

type Props = {
	onToggleSidebar: () => void;
};

export function SidebarHeader( { onToggleSidebar }: Props ) {
	const isFullscreen = useFullscreen();
	return (
		<div className={ `${ styles.root } ${ isFullscreen ? styles.fullscreen : '' }` }>
			<span className={ styles.title }>{ __( 'Studio' ) }</span>
			<div className={ styles.actions }>
				<Menu.Root modal={ false }>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ plus }
								label={ __( 'Create new' ) }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="start" className={ styles.popup }>
						<Menu.Item>
							<Icon icon={ comment } size={ 16 } />
							<span>{ __( 'New chat' ) }</span>
						</Menu.Item>
						<Menu.Item>
							<Icon icon={ globe } size={ 16 } />
							<span>{ __( 'New site project' ) }</span>
						</Menu.Item>
						<Menu.Item>
							<Icon icon={ download } size={ 16 } />
							<span>{ __( 'Import from…' ) }</span>
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ drawerIcon }
					label={ __( 'Hide sidebar' ) }
					onClick={ onToggleSidebar }
				/>
			</div>
		</div>
	);
}
