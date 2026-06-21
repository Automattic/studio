import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { comment, download, globe, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';

type Props = {
	onToggleSidebar: () => void;
};

export function SidebarHeader( { onToggleSidebar }: Props ) {
	const isFullscreen = useFullscreen();
	const navigate = useNavigate();
	const connector = useConnector();
	const queryClient = useQueryClient();

	// Create a fresh unbound chat and open it. Mirrors `newSessionRoute`, which
	// is site-scoped; this is the no-site equivalent for the top-level menu.
	const startNewChat = async () => {
		const session = await connector.createSession();
		void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
		await navigate( { to: '/sessions/$sessionId', params: { sessionId: session.id } } );
	};

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
					<Menu.Popup side="bottom" align="end" className={ styles.popup }>
						<Menu.Item onClick={ () => void startNewChat() }>
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
