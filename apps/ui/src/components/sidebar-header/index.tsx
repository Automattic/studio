import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';

export function SidebarHeader() {
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
						<Menu.Item onClick={ () => void navigate( { to: '/onboarding' } ) }>
							{ __( 'Add a site' ) }
						</Menu.Item>
						<Menu.Item onClick={ () => void navigate( { to: '/onboarding/plugin' } ) }>
							{ __( 'Add a plugin' ) }
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
			</div>
		</div>
	);
}
