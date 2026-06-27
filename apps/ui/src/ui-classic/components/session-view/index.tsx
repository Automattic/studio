import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import * as Menu from '@/components/menu';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { type Annotation } from '@/components/site-preview/types';
import { useAgentRun } from '@/data/queries/use-agent-run';
import {
	useSession,
	useSessionEffectiveEnvironment,
	useSessions,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider, useSessionPreviewAnnotations } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton, type ComposerHandle } from './composer';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface SessionHeaderProps {
	summary: AiSessionSummary;
}

function getSessionTimestamp( session: AiSessionSummary ): number {
	return Date.parse( session.updatedAt ) || 0;
}

function getSessionLabel( session: AiSessionSummary ): string {
	return session.firstPrompt?.trim() || __( 'Untitled chat' );
}

function getSiteChatHistory(
	sessions: AiSessionSummary[] | undefined,
	currentSummary: AiSessionSummary | undefined,
	ownerSitePath: string | undefined
): AiSessionSummary[] {
	if ( ! ownerSitePath ) {
		return [];
	}

	const sessionsById = new Map< string, AiSessionSummary >();
	for ( const session of sessions ?? [] ) {
		if ( session.ownerSitePath === ownerSitePath && ! session.archived ) {
			sessionsById.set( session.id, session );
		}
	}
	if (
		currentSummary &&
		currentSummary.ownerSitePath === ownerSitePath &&
		! currentSummary.archived
	) {
		sessionsById.set( currentSummary.id, currentSummary );
	}

	return [ ...sessionsById.values() ].sort(
		( a, b ) => getSessionTimestamp( b ) - getSessionTimestamp( a )
	);
}

function SessionHeader( { summary }: SessionHeaderProps ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );
	const effectiveEnvironment = useSessionEffectiveEnvironment( summary, site?.id );
	if ( ! siteName ) {
		return null;
	}

	return (
		<div className={ clsx( styles.header, sidebarCollapsed && styles.headerSidebarCollapsed ) }>
			{ site ? (
				<SiteDropdown
					site={ site }
					activeEnvironment={ effectiveEnvironment }
					showStatus={ sidebarCollapsed }
				/>
			) : (
				<>
					{ sidebarCollapsed ? (
						<SiteIcon className={ styles.headerSiteIcon } seed={ siteName } />
					) : null }
					<span className={ styles.headerSite }>{ siteName }</span>
					<span className={ styles.headerDot } aria-hidden="true" />
					<span className={ styles.headerEnv }>
						{ effectiveEnvironment === 'live' ? __( 'Live' ) : __( 'Local' ) }
					</span>
				</>
			) }
			<span className={ styles.headerSpacer } aria-hidden="true" />
		</div>
	);
}

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	composerFooter?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PreviewSplitFrame, which keeps it mounted across routes.
function SessionFrame( {
	header,
	composer,
	composerFooter,
	scrollRef,
	children,
}: SessionFrameProps ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const headerRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< HTMLDivElement >( null );
	const sidebarCollapsed = useSidebarCollapsed();

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}

		const updateChromeSize = () => {
			root.style.setProperty(
				'--classic-header-height',
				`${ headerRef.current?.offsetHeight ?? 0 }px`
			);
			root.style.setProperty(
				'--classic-composer-height',
				`${ composerRef.current?.offsetHeight ?? 0 }px`
			);
		};

		updateChromeSize();

		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateChromeSize );
			return () => window.removeEventListener( 'resize', updateChromeSize );
		}

		const resizeObserver = new ResizeObserver( updateChromeSize );
		if ( headerRef.current ) {
			resizeObserver.observe( headerRef.current );
		}
		if ( composerRef.current ) {
			resizeObserver.observe( composerRef.current );
		}

		return () => resizeObserver.disconnect();
	}, [] );

	return (
		<div ref={ rootRef } className={ styles.root }>
			<div ref={ headerRef } className={ styles.headerLayer }>
				{ header }
			</div>
			<div ref={ scrollRef } className={ clsx( styles.scroll, styles.classicScroll ) }>
				{ children }
			</div>
			<ProgressiveBlur direction="down" className={ styles.headerBlur } fadeToSurface />
			<ProgressiveBlur direction="up" className={ styles.composerBlur } />
			<div
				ref={ composerRef }
				className={ clsx( styles.composerOuter, styles.classicComposerOuter ) }
			>
				{ composer }
				<div
					className={ clsx(
						styles.classicComposerFooter,
						sidebarCollapsed && styles.classicComposerFooterSidebarCollapsed
					) }
				>
					{ composerFooter }
				</div>
			</div>
		</div>
	);
}

export function SessionView( { sessionId }: { sessionId: string } ) {
	return (
		<SessionUIProvider>
			<SessionViewContent sessionId={ sessionId } />
		</SessionUIProvider>
	);
}

function SessionViewContent( { sessionId }: { sessionId: string } ) {
	const navigate = useNavigate();
	const { data, isLoading, error } = useSession( sessionId );
	const { data: sessions } = useSessions();
	const { data: sites } = useSites();
	const ownerSitePath = data?.summary.ownerSitePath;
	const ownerSite = ownerSitePath
		? sites?.find( ( candidate ) => candidate.path === ownerSitePath )
		: undefined;
	const effectiveEnvironment = useSessionEffectiveEnvironment( data?.summary, ownerSite?.id );
	const {
		isRunning,
		hasActiveRun,
		isInterrupting,
		startedAt,
		error: runError,
		pendingQuestions,
		pendingAnswers,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		removeQueuedPrompt,
	} = useAgentRun( sessionId );
	const currentModel = useMemo(
		() => resolveSessionModel( data?.entries ?? [] ),
		[ data?.entries ]
	);
	const siteChatHistory = useMemo(
		() => getSiteChatHistory( sessions, data?.summary, ownerSitePath ),
		[ data?.summary, ownerSitePath, sessions ]
	);
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0;
	const isEmpty = useMemo(
		() =>
			! ( data?.entries ?? [] ).some(
				( entry ) => entry.type === 'custom' && entry.customType === 'studio.user_prompt'
			),
		[ data?.entries ]
	);
	const scrollRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< ComposerHandle >( null );
	useSessionCommands( sessionId );
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';

	const handleAnnotationsDone = useCallback(
		( annotations: Annotation[] ) => {
			if ( annotations.length === 0 ) return;
			void sendMessage( formatAnnotationsAsPrompt( annotations ), {
				displayMessage: formatAnnotationsSubmittedMessage( annotations.length ),
			} );
		},
		[ sendMessage ]
	);
	// The preview panel itself is hosted by the dashboard layout; route its
	// annotation submissions to this session while it is on screen.
	useSessionPreviewAnnotations( handleAnnotationsDone, canTogglePreview );

	const reopenQueuedPrompt = useCallback(
		( queuedPrompt: ( typeof queuedPrompts )[ number ] ) => {
			removeQueuedPrompt( queuedPrompt.id );
			composerRef.current?.replaceDraft( queuedPrompt.prompt, {
				images: queuedPrompt.images,
				files: queuedPrompt.files,
			} );
		},
		[ removeQueuedPrompt ]
	);
	const startNewChat = useCallback( () => {
		if ( ! ownerSite ) {
			return;
		}

		void navigate( {
			to: '/sites/$siteId/new',
			params: { siteId: ownerSite.id },
		} );
	}, [ navigate, ownerSite ] );
	const openChat = useCallback(
		( nextSessionId: string ) => {
			void navigate( {
				to: '/sessions/$sessionId',
				params: { sessionId: nextSessionId },
			} );
		},
		[ navigate ]
	);

	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		node.scrollTop = node.scrollHeight;
		const id = requestAnimationFrame( () => {
			node.scrollTop = node.scrollHeight;
		} );
		return () => cancelAnimationFrame( id );
	}, [ sessionId, data, isRunning, queuedPrompts.length ] );

	if ( isLoading ) {
		// Use the same SessionFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the EmptyBackground canvas jumps
		// mid-transition.
		return (
			<SessionFrame
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ clsx( styles.classicColumn, styles.classicComposerColumn ) }>
						<ComposerSkeleton />
					</div>
				}
			>
				<EmptyBackground />
			</SessionFrame>
		);
	}

	if ( error || ! data ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Session not found' ) }</h1>
				<p>{ sessionId }</p>
			</div>
		);
	}

	return (
		<SessionFrame
			scrollRef={ scrollRef }
			header={ <SessionHeader summary={ data.summary } /> }
			composerFooter={
				<>
					<div className={ styles.classicComposerFooterSide }>
						{ ownerSite ? (
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.classicComposerTextButton }
								onClick={ startNewChat }
							>
								{ __( 'New chat' ) }
							</Button>
						) : null }
					</div>
					<div className={ styles.classicComposerFooterSide }>
						<Menu.Root modal={ false }>
							<Menu.Trigger
								render={
									<Button
										variant="minimal"
										tone="neutral"
										size="small"
										className={ clsx(
											styles.classicComposerTextButton,
											styles.classicComposerHistoryButton
										) }
									>
										<span>{ __( 'Chat history' ) }</span>
										<Icon icon={ chevronDownSmall } size={ 16 } />
									</Button>
								}
							/>
							<Menu.Popup side="top" align="end" className={ styles.classicComposerHistoryMenu }>
								{ siteChatHistory.length > 0 ? (
									siteChatHistory.map( ( session ) => {
										const isCurrent = session.id === sessionId;
										return (
											<Menu.Item
												key={ session.id }
												className={ styles.classicComposerHistoryItem }
												aria-current={ isCurrent ? 'page' : undefined }
												data-current={ isCurrent ? 'true' : undefined }
												onClick={ () => openChat( session.id ) }
											>
												<span className={ styles.classicComposerHistoryTitle }>
													{ getSessionLabel( session ) }
												</span>
												<span className={ styles.classicComposerHistoryMeta }>
													{ isCurrent
														? __( 'Current chat' )
														: formatRelativeTime( session.updatedAt ) }
												</span>
											</Menu.Item>
										);
									} )
								) : (
									<div className={ styles.classicComposerHistoryEmpty }>
										{ __( 'No chats yet.' ) }
									</div>
								) }
							</Menu.Popup>
						</Menu.Root>
					</div>
				</>
			}
			composer={
				<div className={ clsx( styles.classicColumn, styles.classicComposerColumn ) }>
					<QueuedPrompts
						prompts={ queuedPrompts }
						onRemove={ removeQueuedPrompt }
						onEdit={ reopenQueuedPrompt }
					/>
					<Composer
						ref={ composerRef }
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						error={ runError }
						model={ currentModel }
						onSend={ sendMessage }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						entries={ data.entries }
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ openChat }
					/>
				</div>
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
			<div className={ clsx( styles.classicColumn, styles.classicConversationSpacing ) }>
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ startedAt }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					onAnswerQuestion={ answerQuestion }
				/>
			</div>
		</SessionFrame>
	);
}
