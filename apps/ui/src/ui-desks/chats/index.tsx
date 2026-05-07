import { Dialog } from '@base-ui/react/dialog';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useCreateSession, useSessions } from '@/data/queries/use-sessions';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { DeskSessionSurface } from './session-surface';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface UserDeskChatsProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	createChatRequestId: number;
}

function getSessionTitle( session: AiSessionSummary ) {
	return session.firstPrompt?.trim() || __( 'New chat' );
}

function getSessionSubtitle( session: AiSessionSummary ) {
	if ( ! session.firstPrompt ) {
		return __( 'Ask Studio Desk anything to get started.' );
	}

	return formatRelativeTime( session.updatedAt );
}

export function UserDeskChats( { open, onOpenChange, createChatRequestId }: UserDeskChatsProps ) {
	const { data: sessions } = useSessions();
	const createSession = useCreateSession();
	const lastCreateChatRequestId = useRef( createChatRequestId );
	const [ selectedSessionId, setSelectedSessionId ] = useState< string | undefined >( undefined );
	const [ expanded, setExpanded ] = useState( false );
	const [ autoFocusSessionId, setAutoFocusSessionId ] = useState< string | undefined >( undefined );
	const userDeskSessions = useMemo(
		() =>
			[ ...( sessions ?? [] ).filter( ( session ) => ! session.ownerSitePath ) ].sort(
				( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt )
			),
		[ sessions ]
	);
	const selectedSession = userDeskSessions.find( ( session ) => session.id === selectedSessionId );

	useEffect( () => {
		if ( selectedSessionId && ! selectedSession ) {
			setSelectedSessionId( undefined );
			setExpanded( false );
		}
	}, [ selectedSession, selectedSessionId ] );

	const handleSelectSession = ( sessionId: string ) => {
		setSelectedSessionId( sessionId );
		setExpanded( true );
		setAutoFocusSessionId( undefined );
	};

	const handleNewChat = useCallback( async () => {
		const session = await createSession.mutateAsync( undefined );
		setSelectedSessionId( session.id );
		setExpanded( true );
		setAutoFocusSessionId( session.id );
	}, [ createSession ] );

	useEffect( () => {
		if ( createChatRequestId === lastCreateChatRequestId.current ) {
			return;
		}

		lastCreateChatRequestId.current = createChatRequestId;
		void handleNewChat();
	}, [ createChatRequestId, handleNewChat ] );

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ onOpenChange }
			modal={ false }
			disablePointerDismissal
		>
			<Dialog.Portal>
				<Dialog.Popup
					initialFocus={ false }
					finalFocus={ false }
					className={ clsx( styles.panel, motionStyles.motion, expanded && styles.panelExpanded ) }
					aria-label={ __( 'Conversations' ) }
				>
					<div className={ styles.listPane }>
						<header className={ styles.header }>
							<h2>{ __( 'Conversations' ) }</h2>
						</header>
						<div className={ styles.list }>
							{ userDeskSessions.map( ( session ) => (
								<button
									key={ session.id }
									type="button"
									className={ clsx(
										styles.sessionItem,
										session.id === selectedSessionId && styles.sessionItemActive
									) }
									onClick={ () => handleSelectSession( session.id ) }
								>
									<span className={ styles.sessionTitle }>{ getSessionTitle( session ) }</span>
									<span className={ styles.sessionSubtitle }>
										{ getSessionSubtitle( session ) }
									</span>
								</button>
							) ) }
						</div>
						<footer className={ styles.footer }>
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.newChatButton }
								loading={ createSession.isPending }
								loadingAnnouncement={ __( 'Creating chat' ) }
								onClick={ () => void handleNewChat() }
							>
								{ __( '+ New chat' ) }
							</Button>
						</footer>
					</div>
					{ expanded ? (
						<div className={ styles.chatPane }>
							{ selectedSessionId ? (
								<DeskSessionSurface
									key={ selectedSessionId }
									sessionId={ selectedSessionId }
									onSwitchSession={ setSelectedSessionId }
									autoFocus={ autoFocusSessionId === selectedSessionId }
								/>
							) : (
								<div className={ styles.emptyChat }>
									{ __( 'Ask Studio Desk anything to get started.' ) }
								</div>
							) }
						</div>
					) : null }
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
