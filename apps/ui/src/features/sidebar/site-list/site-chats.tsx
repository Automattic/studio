import { __, sprintf } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSessionTitle } from '@/features/chats';
import {
	CollapsiblePanel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuLabel,
} from '@/lib/ui';
import { ChatRow, RetryLoadingChats } from './chat-row';
import { mergeVisibleOrder } from './sidebar-collections';
import { SidebarReorderableList } from './sidebar-reorderable-list';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';
import type { ReorderableItemProps } from '@/features/sidebar/reorderable-list';

// Chats listed at first under a site, and how many more each Show more adds.
const CHATS_INITIAL_COUNT = 5;
const CHATS_PAGE_SIZE = 10;

// The chats listed under a site's row.
export function SiteChats( {
	site,
	chats,
	open,
	expanded,
	loadError,
	reorderable,
	activeSessionId,
	onReorderChats,
	onSiteOpen,
}: {
	site: SiteDetails;
	chats: AiSessionSummary[];
	open: boolean;
	// Folding the site resets Show more.
	expanded: boolean;
	loadError: boolean;
	reorderable: boolean;
	activeSessionId?: string;
	onReorderChats: ( ids: string[] ) => void;
	onSiteOpen?: () => void;
} ) {
	const [ chatCount, setChatCount ] = useState( CHATS_INITIAL_COUNT );
	const visibleChats = chats.slice( 0, chatCount );
	useEffect( () => {
		if ( ! expanded ) {
			setChatCount( CHATS_INITIAL_COUNT );
		}
	}, [ expanded ] );
	const renderChat = ( session: AiSessionSummary, itemProps?: ReorderableItemProps ) => (
		<ChatRow
			key={ session.id }
			session={ session }
			active={ session.id === activeSessionId }
			nested
			onOpen={ onSiteOpen }
			itemProps={ itemProps }
		/>
	);
	const showMore =
		chats.length > chatCount ? (
			<SidebarMenuItem>
				<SidebarMenuButton
					muted
					inset
					onClick={ () => setChatCount( ( count ) => count + CHATS_PAGE_SIZE ) }
				>
					<EllipsisIcon />
					<SidebarMenuLabel>{ __( 'Show more' ) }</SidebarMenuLabel>
				</SidebarMenuButton>
			</SidebarMenuItem>
		) : null;

	return (
		<CollapsiblePanel open={ open }>
			<div
				role="group"
				aria-label={ sprintf(
					/* translators: %s: site name. */
					__( '%s chats' ),
					site.name
				) }
				className={ styles.chats }
			>
				{ loadError ? (
					<SidebarMenu>
						<RetryLoadingChats />
					</SidebarMenu>
				) : null }
				{ reorderable ? (
					<SidebarReorderableList
						items={ visibleChats }
						getItemId={ ( session ) => session.id }
						getItemLabel={ getSessionTitle }
						renderItem={ renderChat }
						onReorder={ ( ids ) =>
							onReorderChats(
								mergeVisibleOrder(
									chats.map( ( session ) => session.id ),
									ids
								)
							)
						}
					>
						{ showMore }
					</SidebarReorderableList>
				) : (
					<SidebarMenu>
						{ visibleChats.map( ( session ) => renderChat( session ) ) }
						{ showMore }
					</SidebarMenu>
				) }
			</div>
		</CollapsiblePanel>
	);
}
