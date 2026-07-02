import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { plugins, plus, wordpress } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { QuickMenuItem } from '@/components/site-quick-menu';
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
								className={ styles.createButton }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<QuickMenuItem
							icon={ wordpress }
							label={ __( 'Add a site' ) }
							onClick={ () => void navigate( { to: '/onboarding' } ) }
						/>
						<QuickMenuItem
							icon={ plugins }
							label={ __( 'Add a plugin' ) }
							onClick={ () => void navigate( { to: '/onboarding/plugin' } ) }
						/>
					</Menu.Popup>
				</Menu.Root>
			</div>
		</div>
	);
}
