import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { comment, download, globe, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

type Props = {
	onToggleSidebar: () => void;
};

export function SidebarHeader( { onToggleSidebar }: Props ) {
	const isFullscreen = useFullscreen();
	const navigate = useNavigate();
	return (
		<div className={ `${ styles.root } ${ isFullscreen ? styles.fullscreen : '' }` }>
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
					<Menu.Popup side="bottom" align="end" className={ styles.popup }>
						<Menu.Item>
							<Icon icon={ comment } />
							<span>{ __( 'New chat' ) }</span>
						</Menu.Item>
						<Menu.Item onClick={ () => void navigate( { to: '/onboarding' } ) }>
							<Icon icon={ globe } />
							<span>{ __( 'New site' ) }</span>
						</Menu.Item>
						<Menu.Item onClick={ () => void navigate( { to: '/onboarding/import' } ) }>
							<Icon icon={ download } />
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
