import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { EllipsisIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSessionTitle } from '@/features/chats';
import { SidebarButton } from '@/features/sidebar/sidebar-button';
import { CollapsiblePanel } from '@/lib/ui';
import { ChatRow, RetryLoadingChats } from './chat-row';
import { mergeVisibleOrder } from './sidebar-collections';
import { SidebarReorderableList } from './sidebar-reorderable-list';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

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
	const renderChat = ( session: AiSessionSummary ) => (
		<ChatRow
			key={ session.id }
			session={ session }
			active={ session.id === activeSessionId }
			nested
			onOpen={ onSiteOpen }
		/>
	);

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
				{ loadError ? <RetryLoadingChats /> : null }
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
					/>
				) : (
					visibleChats.map( renderChat )
				) }
				{ chats.length > chatCount ? (
					<SidebarButton
						className={ clsx( styles.chat, styles.mutedRow ) }
						onClick={ () => setChatCount( ( count ) => count + CHATS_PAGE_SIZE ) }
					>
						<EllipsisIcon className={ styles.rowIcon } />
						<span className={ styles.chatTitle }>{ __( 'Show more' ) }</span>
					</SidebarButton>
				) : null }
			</div>
		</CollapsiblePanel>
	);
}
