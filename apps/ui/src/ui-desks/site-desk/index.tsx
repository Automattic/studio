import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useSites } from '@/data/queries/use-sites';
import { SiteDeskChats } from '../chats';
import { DeskHeader } from '../chrome';
import { DeskChatsButton } from '../chrome/chats-button';
import { DeskMenu } from '../chrome/user-menu';
import { desksRootRoute } from '../router/root';
import styles from './style.module.css';

interface SiteDeskSearch {
	chats?: boolean;
	newChat?: number;
}

function parseChatsSearch( value: unknown ) {
	return value === true || value === 'true' || value === '1' || value === 'open';
}

function parseNewChatSearch( value: unknown ) {
	const parsed = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( parsed ) && parsed > 0 ? parsed : undefined;
}

export function SiteDesk() {
	const { siteId } = siteDeskRoute.useParams();
	const { chats, newChat } = siteDeskRoute.useSearch() as SiteDeskSearch;
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const chatsOpen = chats === true;

	const setChatsOpen = ( open: boolean ) => {
		void navigate( {
			to: '/sites/$siteId',
			params: { siteId },
			search: ( previous: SiteDeskSearch ) => ( {
				...previous,
				chats: open ? true : undefined,
			} ),
		} );
	};

	return (
		<>
			<SiteDeskChats
				open={ chatsOpen }
				onOpenChange={ setChatsOpen }
				createChatRequestId={ newChat ?? 0 }
				siteId={ siteId }
				sitePath={ site?.path }
			/>
			<main className={ styles.root } aria-label={ __( 'Site desk' ) } data-site-id={ siteId }>
				<DeskHeader>
					<DeskMenu activeSiteId={ siteId } />
					<DeskChatsButton open={ chatsOpen } onToggle={ () => setChatsOpen( ! chatsOpen ) } />
				</DeskHeader>
			</main>
		</>
	);
}

export const siteDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId',
	validateSearch: ( search: Record< string, unknown > ): SiteDeskSearch => ( {
		chats: parseChatsSearch( search.chats ) || undefined,
		newChat: parseNewChatSearch( search.newChat ),
	} ),
	component: SiteDesk,
} );
