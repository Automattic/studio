import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PreviewSplitContent } from '@/components/preview-split-frame';
import { type Annotation } from '@/components/site-preview/types';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	useMarkSessionRead,
	useSession,
	useSessionEffectiveEnvironment,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider, useSessionPreviewAnnotations } from '@/hooks/use-session-ui';
import { SiteMenuHeader } from '@/ui-classic/components/site-menu-header';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton } from './composer';
import { pickLiveSite } from './composer/environment-pill';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface SessionHeaderProps {
	summary: AiSessionSummary;
}

function SessionHeader( { summary }: SessionHeaderProps ) {
	const siteName = summary.ownerSiteName;
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );
	const effectiveEnvironment = useSessionEffectiveEnvironment( summary, site?.id );
	if ( ! siteName ) {
		return null;
	}

	return (
		<SiteMenuHeader
			site={ site }
			fallbackSiteName={ siteName }
			activeEnvironment={ effectiveEnvironment }
		/>
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
	const { mutate: markSessionRead } = useMarkSessionRead();
	const lastReadMarkRef = useRef< string | null >( null );
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
	useSessionPreviewAnnotations( handleAnnotationsDone, canTogglePreview && !! ownerSite );

	useEffect( () => {
		// Wait for the subprocess to exit before marking read: the mutation's
		// invalidation refetches the session, and during a run the on-disk
		// event count keeps growing, so each refetch would re-trigger the
		// mutation in a loop while racing the optimistic transcript writes.
		if ( ! data || hasActiveRun ) {
			return;
		}
		const eventCount = data.summary.eventCount;
		const lastReadEventCount = data.summary.lastReadEventCount ?? -1;
		const markKey = `${ sessionId }:${ eventCount }`;
		if ( eventCount > lastReadEventCount && lastReadMarkRef.current !== markKey ) {
			lastReadMarkRef.current = markKey;
			markSessionRead( { sessionId, eventCount } );
		}
	}, [ data, hasActiveRun, markSessionRead, sessionId ] );

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
				scrollClassName={ clsx( styles.scroll, styles.classicScroll ) }
				composerOuterClassName={ clsx( styles.composerOuter, styles.classicComposerOuter ) }
				header={ <SiteMenuHeader /> }
				composer={
					<div className={ styles.classicColumn }>
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
			scrollClassName={ clsx( styles.scroll, styles.classicScroll ) }
			composerOuterClassName={ clsx( styles.composerOuter, styles.classicComposerOuter ) }
			header={ <SessionHeader summary={ data.summary } /> }
			composer={
				<div className={ styles.classicColumn }>
					<QueuedPrompts prompts={ queuedPrompts } onRemove={ removeQueuedPrompt } />
					<Composer
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						error={ runError }
						model={ currentModel }
						onSend={ sendMessage }
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
		</PreviewSplitContent>
	);
}
