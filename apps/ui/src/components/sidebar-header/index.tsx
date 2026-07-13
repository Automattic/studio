import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

type Props = {
	onToggleSidebar: () => void;
};

export function SidebarHeader( { onToggleSidebar }: Props ) {
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const navigate = useNavigate();
	return (
		<div className={ `${ styles.root } ${ reserveTrafficLightSpace ? '' : styles.flush }` }>
			<span className={ styles.title }>{ __( 'Studio' ) }</span>
			<div className={ styles.actions }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ plus }
					label={ __( 'Add site' ) }
					onClick={ () => void navigate( { to: '/onboarding' } ) }
				/>
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
