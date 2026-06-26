import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { type Annotation } from '@/components/site-preview/types';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider, useSessionPreviewAnnotations } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton, type ComposerHandle } from './composer';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
import { ThinkingIndicator } from './thinking-indicator';
import type { AiSessionSummary } from '@/data/core';

interface SessionHeaderProps {
	summary: AiSessionSummary;
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
					showSiteIcon={ sidebarCollapsed }
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
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PreviewSplitFrame, which keeps it mounted across routes.
function SessionFrame( { header, composer, scrollRef, children }: SessionFrameProps ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const headerRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< HTMLDivElement >( null );

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
	const sidebarCollapsed = useSidebarCollapsed();
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const composerStatusMessage = useMemo( () => {
		if ( isInterrupting ) {
			return __( 'Stopping' );
		}
		if ( pendingQuestions.length > 0 ) {
			return __( 'Waiting for your answer' );
		}
		if ( hasActiveRun && ! isRunning ) {
			return __( 'Wrapping up' );
		}
		if ( queuedPrompts.length > 0 ) {
			return __( 'Next message queued' );
		}
		return __( 'Ready for next task' );
	}, [ hasActiveRun, isInterrupting, isRunning, pendingQuestions.length, queuedPrompts.length ] );

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
						<div
							className={ clsx(
								styles.classicComposerStatusRow,
								sidebarCollapsed && styles.classicComposerStatusRowSidebarCollapsed
							) }
							aria-hidden="true"
						/>
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
						onSwitchSession={ ( nextSessionId ) =>
							void navigate( {
								to: '/sessions/$sessionId',
								params: { sessionId: nextSessionId },
							} )
						}
					/>
					<div
						className={ clsx(
							styles.classicComposerStatusRow,
							sidebarCollapsed && styles.classicComposerStatusRowSidebarCollapsed
						) }
					>
						<ThinkingIndicator
							active={ isRunning && pendingQuestions.length === 0 }
							idleMessage={ composerStatusMessage }
							startedAt={ startedAt }
						/>
						{ ownerSite ? (
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.classicComposerNewChatButton }
								onClick={ startNewChat }
							>
								{ __( 'New chat' ) }
							</Button>
						) : null }
					</div>
				</div>
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
			<div className={ clsx( styles.classicColumn, styles.classicConversationSpacing ) }>
				<Conversation
					data={ data }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					onAnswerQuestion={ answerQuestion }
				/>
			</div>
		</SessionFrame>
	);
}
