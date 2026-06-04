import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { PreviewSplitContent } from '@/components/preview-split-frame';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { type Annotation } from '@/components/site-preview/types';
import { SitePreviewToggleButton } from '@/components/site-preview-toggle-button';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useSessionCommands } from '@/hooks/use-session-commands';
import {
	SessionUIProvider,
	useSessionExplorerUI,
	useSessionPreviewAnnotations,
	useSessionPreviewUI,
} from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import {
	buildExplorerAgentPrompt,
	getVisibleExplorerPanelKinds,
} from '@/lib/explorer-agent-context';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton } from './composer';
import { pickLiveSite } from './composer/environment-pill';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
import type { AiSessionSummary, StudioChatImage } from '@/data/core';

interface SessionHeaderProps {
	summary: AiSessionSummary;
	previewOpen: boolean;
	onTogglePreview: () => void;
	canTogglePreview: boolean;
}

function SessionHeader( {
	summary,
	previewOpen,
	onTogglePreview,
	canTogglePreview,
}: SessionHeaderProps ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );
	const effectiveEnvironment = useSessionEffectiveEnvironment( summary, site?.id );
	const previewShortcut = getKeyboardShortcutDescriptor(
		getKeyboardShortcut( 'toggle-site-preview' )
	);
	if ( ! siteName ) {
		return null;
	}

	return (
		<div className={ styles.header }>
			<ProgressiveBlur />
			<div
				className={ clsx(
					styles.headerContent,
					! sidebarCollapsed && styles.headerContentSidebarOpen
				) }
			>
				{ sidebarCollapsed && ! isFullscreen ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
				{ site ? (
					<SiteDropdown
						site={ site }
						activeEnvironment={ effectiveEnvironment }
						showSiteIcon={ sidebarCollapsed }
					/>
				) : (
					<>
						{ sidebarCollapsed ? (
							<SiteIcon className={ styles.headerSiteIcon } seed={ siteName } />
						) : null }
						<span className={ styles.headerDot } aria-hidden="true" />
						<span className={ styles.headerSite }>{ siteName }</span>
					</>
				) }
				<span className={ styles.headerSpacer } aria-hidden="true" />
				{ canTogglePreview ? (
					<div className={ styles.headerActions }>
						<SitePreviewToggleButton
							previewOpen={ previewOpen }
							onTogglePreview={ onTogglePreview }
							shortcut={ previewShortcut }
						/>
					</div>
				) : null }
			</div>
		</div>
	);
}

export function SessionView( {
	sessionId,
	autoFocusComposer = false,
}: {
	sessionId: string;
	autoFocusComposer?: boolean;
} ) {
	return (
		<SessionUIProvider>
			<SessionViewContent sessionId={ sessionId } autoFocusComposer={ autoFocusComposer } />
		</SessionUIProvider>
	);
}

function SessionViewContent( {
	sessionId,
	autoFocusComposer,
}: {
	sessionId: string;
	autoFocusComposer: boolean;
} ) {
	const navigate = useNavigate();
	const { data, isLoading, error } = useSession( sessionId );
	const { data: sites } = useSites();
	const ownerSitePath = data?.summary.ownerSitePath;
	const ownerSite = ownerSitePath
		? sites?.find( ( candidate ) => candidate.path === ownerSitePath )
		: undefined;
	const { data: connectedSites } = useConnectedWpcomSites( ownerSite?.id );
	const liveSite = pickLiveSite( connectedSites );
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
	useSessionCommands( sessionId );
	const preview = useSessionPreviewUI();
	const explorer = useSessionExplorerUI();
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const showPreview = preview.open && canTogglePreview;
	const ownerSiteId = ownerSite?.id;
	const createNewChatForSite = useCallback( () => {
		if ( ! ownerSiteId ) {
			return;
		}
		void navigate( {
			to: '/sites/$siteId/new',
			params: { siteId: ownerSiteId },
			search: { focusComposer: true },
		} );
	}, [ navigate, ownerSiteId ] );
	useKeyboardShortcut( 'new-chat-in-current-site', createNewChatForSite, {
		enabled: !! ownerSiteId,
	} );
	useKeyboardShortcut( 'toggle-site-preview', preview.toggle, {
		enabled: canTogglePreview,
	} );

	const handleAnnotationsDone = useCallback(
		( annotations: Annotation[] ) => {
			if ( annotations.length === 0 ) return;
			void sendMessage( formatAnnotationsAsPrompt( annotations ), {
				displayMessage: formatAnnotationsSubmittedMessage( annotations.length ),
			} );
		},
		[ sendMessage ]
	);
	useSessionPreviewAnnotations( handleAnnotationsDone, canTogglePreview && !! ownerSite );
	const sendComposerMessage = useCallback(
		( prompt: string, options?: { displayMessage?: string; images?: StudioChatImage[] } ) =>
			sendMessage(
				buildExplorerAgentPrompt( {
					prompt,
					visiblePanelKinds: explorer.open
						? getVisibleExplorerPanelKinds( {
								visibleTabIds: explorer.visibleTabIds,
								tabs: preview.tabs,
						  } )
						: [],
					browserPath: preview.path,
				} ),
				{
					...options,
					displayMessage: options?.displayMessage ?? prompt,
				}
			),
		[ explorer.open, explorer.visibleTabIds, preview.path, preview.tabs, sendMessage ]
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
		// Use the same PreviewSplitFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the EmptyBackground canvas jumps
		// mid-transition.
		return (
			<PreviewSplitContent
				scrollClassName={ clsx( styles.scroll, styles.studioScroll ) }
				composerOuterClassName={ clsx( styles.composerOuter, styles.studioComposerOuter ) }
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ styles.studioColumn }>
						<ComposerSkeleton />
					</div>
				}
			>
				<EmptyBackground />
			</PreviewSplitContent>
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
		<PreviewSplitContent
			scrollRef={ scrollRef }
			scrollClassName={ clsx( styles.scroll, styles.studioScroll ) }
			composerOuterClassName={ clsx( styles.composerOuter, styles.studioComposerOuter ) }
			header={
				<SessionHeader
					summary={ data.summary }
					previewOpen={ showPreview }
					onTogglePreview={ preview.toggle }
					canTogglePreview={ canTogglePreview }
				/>
			}
			composer={
				<div className={ styles.studioColumn }>
					<QueuedPrompts prompts={ queuedPrompts } onRemove={ removeQueuedPrompt } />
					<Composer
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						error={ runError }
						model={ currentModel }
						onSend={ sendComposerMessage }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						effectiveEnvironment={ effectiveEnvironment }
						liveSite={ liveSite }
						entries={ data.entries }
						ownerSiteId={ ownerSite?.id }
						autoFocus={ autoFocusComposer }
						onSwitchSession={ ( nextSessionId ) =>
							void navigate( {
								to: '/sessions/$sessionId',
								params: { sessionId: nextSessionId },
							} )
						}
					/>
				</div>
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
			<div className={ clsx( styles.studioColumn, styles.studioConversationSpacing ) }>
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ startedAt }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					onAnswerQuestion={ answerQuestion }
				/>
			</div>
		</PreviewSplitContent>
	);
}
