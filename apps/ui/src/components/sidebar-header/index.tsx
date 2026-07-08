import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { plugins, plus, wordpress } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import * as Menu from '@/components/menu';
import { QuickMenuItem } from '@/components/site-quick-menu';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';

export function SidebarHeader() {
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const navigate = useNavigate();
	const createAnchorRef = useTourAnchor( 'sidebar-create-site' );

	return (
		<div className={ `${ styles.root } ${ reserveTrafficLightSpace ? '' : styles.flush }` }>
			<div className={ styles.actions } ref={ createAnchorRef }>
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
