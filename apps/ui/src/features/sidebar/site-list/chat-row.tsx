import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { useSiteAgentActivity } from '@/data/agent-runs/use-agent-run';
import { useSessions } from '@/data/queries/use-sessions';
import { chatPinKey } from '@/data/queries/use-sidebar-pins';
import { ChatActionsMenuItems, useChatActions, getSessionTitle } from '@/features/chats';
import { ArchiveIcon, ChatIcon, NeedsInputIcon, PinIcon, UnpinIcon } from '@/lib/icons';
import {
	Badge,
	IconButton,
	Menu,
	NotificationDot,
	SidebarMenuActions,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuLabel,
	VisuallyHidden,
} from '@/lib/ui';
import { BulkMenu, useIsBulkTarget, useRowPressed, useSelectableRow } from './selection';
import type { AiSessionSummary } from '@/data/core';
import type { ReorderableItemProps } from '@/features/sidebar/reorderable-list';

export function RetryLoadingChats() {
	const { refetch } = useSessions();
	return (
		<SidebarMenuItem>
			<SidebarMenuButton onClick={ () => void refetch() }>
				<SidebarMenuLabel>{ __( 'Retry loading chats' ) }</SidebarMenuLabel>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function ChatRow( {
	session,
	active,
	nested = false,
	siteName,
	onOpen,
	itemProps,
}: {
	session: AiSessionSummary;
	active: boolean;
	// Under its site the row indents to the site's name and drops its icon.
	nested?: boolean;
	// Away from its site, the row names it in a tooltip.
	siteName?: string;
	onOpen?: () => void;
	// Drag handling, when the row is in a reorderable list.
	itemProps?: ReorderableItemProps;
} ) {
	const navigate = useNavigate();
	const activity = useSiteAgentActivity( [ session.id ] );
	const actions = useChatActions( session, active );
	const selectable = useSelectableRow( chatPinKey( session.id ) );
	const bulk = useIsBulkTarget( chatPinKey( session.id ) );
	const pressed = useRowPressed( chatPinKey( session.id ) );
	const [ menuOpen, setMenuOpen ] = useState( false );
	const title = getSessionTitle( session );
	const needsInput = activity === 'pending-question';

	return (
		<>
			<Menu.ContextMenuRoot open={ menuOpen } onOpenChange={ setMenuOpen }>
				<Menu.ContextMenuTrigger
					render={
						<SidebarMenuItem { ...itemProps } { ...selectable } { ...actions.shortcuts }>
							<SidebarMenuButton
								active={ active }
								inset={ nested }
								aria-current={ active ? 'page' : undefined }
								aria-pressed={ pressed }
								tooltip={
									siteName
										? sprintf(
												/* translators: 1: chat title, 2: the chat's site. */
												__( '%1$s — %2$s' ),
												title,
												siteName
										  )
										: undefined
								}
								onClick={ () => {
									onOpen?.();
									void navigate( {
										to: '/sessions/$sessionId',
										params: { sessionId: session.id },
									} );
								} }
							>
								{ nested ? null : <ChatIcon /> }
								{ actions.working ? <VisuallyHidden>{ __( 'Working…' ) }</VisuallyHidden> : null }
								<SidebarMenuLabel className={ actions.working ? 'studio-shimmer' : undefined }>
									{ title }
								</SidebarMenuLabel>
								{ needsInput ? (
									<Badge
										variant="accent"
										size="icon"
										role="status"
										aria-label={ __( 'WordPress Studio needs an answer.' ) }
									>
										<NeedsInputIcon />
									</Badge>
								) : null }
								{ session.unread && ! active ? (
									<NotificationDot position="end" label={ __( 'Unread' ) } />
								) : null }
							</SidebarMenuButton>
							{ needsInput ? null : (
								<SidebarMenuActions showOnHover={ ! active || nested } data-reorder-exclude>
									<IconButton
										variant="muted-ghost"
										size="icon-sm"
										icon={ actions.pinned ? <UnpinIcon /> : <PinIcon /> }
										label={ actions.pinned ? __( 'Unpin chat' ) : __( 'Pin chat' ) }
										onClick={ actions.togglePin }
									/>
									<IconButton
										variant="muted-ghost"
										size="icon-sm"
										icon={ <ArchiveIcon /> }
										label={ __( 'Archive chat' ) }
										disabled={ actions.archiveBlocked }
										onClick={ () => void actions.archive() }
									/>
								</SidebarMenuActions>
							) }
						</SidebarMenuItem>
					}
				/>
				{ bulk ? (
					<BulkMenu onClose={ () => setMenuOpen( false ) } />
				) : (
					<Menu.ContextPopup { ...actions.shortcuts }>
						<ChatActionsMenuItems actions={ actions } />
					</Menu.ContextPopup>
				) }
			</Menu.ContextMenuRoot>
			{ actions.renameDialog }
		</>
	);
}
