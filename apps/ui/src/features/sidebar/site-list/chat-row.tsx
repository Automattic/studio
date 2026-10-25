import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useSiteAgentActivity } from '@/data/agent-runs/use-agent-run';
import { useSessions } from '@/data/queries/use-sessions';
import { chatPinKey } from '@/data/queries/use-sidebar-pins';
import { ChatActionsMenuItems, useChatActions, getSessionTitle } from '@/features/chats';
import { SidebarButton } from '@/features/sidebar/sidebar-button';
import { ArchiveIcon, ChatIcon, NeedsInputIcon, PinIcon, UnpinIcon } from '@/lib/icons';
import {
	Badge,
	IconButton,
	Menu,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	VisuallyHidden,
} from '@/lib/ui';
import { BulkMenu, useIsBulkTarget, useRowPressed, useSelectableRow } from './selection';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

export function RetryLoadingChats() {
	const { refetch } = useSessions();
	return (
		<SidebarButton className={ styles.chat } onClick={ () => void refetch() }>
			<span className={ styles.chatTitle }>{ __( 'Retry loading chats' ) }</span>
		</SidebarButton>
	);
}

export function ChatRow( {
	session,
	active,
	nested = false,
	siteName,
	onOpen,
}: {
	session: AiSessionSummary;
	active: boolean;
	// Under its site the row indents to the site's name and drops its icon.
	nested?: boolean;
	// Away from its site, the row names it in a tooltip.
	siteName?: string;
	onOpen?: () => void;
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

	const button = (
		<SidebarButton
			className={ styles.chat }
			aria-current={ active ? 'page' : undefined }
			aria-pressed={ pressed }
			onClick={ () => {
				onOpen?.();
				void navigate( {
					to: '/sessions/$sessionId',
					params: { sessionId: session.id },
				} );
			} }
		>
			{ nested ? null : <ChatIcon className={ styles.rowIcon } /> }
			{ actions.working ? <VisuallyHidden>{ __( 'Working…' ) }</VisuallyHidden> : null }
			<span className={ clsx( styles.chatTitle, actions.working && 'studio-shimmer' ) }>
				{ title }
			</span>
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
				<span className={ styles.unreadDot } role="img" aria-label={ __( 'Unread' ) } />
			) : null }
		</SidebarButton>
	);

	return (
		<>
			<Menu.ContextMenuRoot open={ menuOpen } onOpenChange={ setMenuOpen }>
				<Menu.ContextMenuTrigger
					render={
						<div
							{ ...selectable }
							{ ...actions.shortcuts }
							className={ clsx(
								styles.chatRow,
								nested && styles.chatNested,
								active && styles.chatActive
							) }
						>
							{ siteName ? (
								<Tooltip>
									<TooltipTrigger render={ button } />
									<TooltipContent side="right">
										{ sprintf(
											/* translators: 1: chat title, 2: the chat's site. */
											__( '%1$s — %2$s' ),
											title,
											siteName
										) }
									</TooltipContent>
								</Tooltip>
							) : (
								button
							) }
							{ needsInput ? null : (
								<span className={ styles.chatActions } data-reorder-exclude>
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
								</span>
							) }
						</div>
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
