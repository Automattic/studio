import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { DeskChats, DeskChatsTrigger } from '../chats';
import { DeskHeader } from '../chrome';
import { DeskMenu } from '../chrome/user-menu';
import { desksRootRoute } from '../router/root';
import styles from './style.module.css';

export function SiteDesk() {
	const { siteId } = siteDeskRoute.useParams();

	return (
		<>
			<DeskChats siteId={ siteId } />
			<main className={ styles.root } aria-label={ __( 'Site desk' ) } data-site-id={ siteId }>
				<DeskHeader>
					<DeskMenu activeSiteId={ siteId } />
					<DeskChatsTrigger />
				</DeskHeader>
			</main>
		</>
	);
}

export const siteDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId',
	component: SiteDesk,
} );
