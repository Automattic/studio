import { resolveSessionModel } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Composer } from '@/components/session-view/composer';
import { Conversation } from '@/components/session-view/conversation';
import { QueuedPrompts } from '@/components/session-view/queued-prompts';
import { SiteDropdown } from '@/components/site-dropdown';
import { useConnector } from '@/data/core';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { SESSIONS_QUERY_KEY, useSession } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { AiModelId, AiSessionSummary, LoadedAiSession } from '@/data/core';

function SessionHeader( { summary }: { summary: AiSessionSummary } ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const { data: sites } = useSites();
	if ( ! siteName ) {
		return null;
	}

	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );
	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
		: null;

	return (
		<div className={ styles.header }>
			{ toggleSpacerClass ? <span className={ toggleSpacerClass } aria-hidden="true" /> : null }
			{ site ? (
				<SiteDropdown site={ site } />
			) : (
				<>
					<span className={ styles.headerSite }>{ siteName }</span>
					<span className={ styles.headerDot } aria-hidden="true" />
					<span className={ styles.headerEnv }>{ __( 'Local' ) }</span>
				</>
			) }
		</div>
	);
}

export function SessionView( { sessionId }: { sessionId: string } ) {
	const { data, isLoading, error } = useSession( sessionId );
	const connector = useConnector();
	const queryClient = useQueryClient();
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
	const currentModel = useMemo( () => resolveSessionModel( data?.events ?? [] ), [ data?.events ] );
	// Optimistically append a `session.model_selected` event so the composer
	// reflects the new pick immediately. The main process writes the same event
	// to the JSONL; if that write fails we fall back to the prior state.
	const onModelChange = useCallback(
		( model: AiModelId ) => {
			const timestamp = new Date().toISOString();
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) =>
					prev
						? {
								...prev,
								events: [ ...prev.events, { type: 'session.model_selected', timestamp, model } ],
						  }
						: prev
			);
			void connector.setSessionModel( sessionId, model ).catch( () => {
				void queryClient.invalidateQueries( {
					queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
				} );
			} );
		},
		[ connector, queryClient, sessionId ]
	);
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0;
	const scrollRef = useRef< HTMLDivElement >( null );

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
		return <div className={ styles.state }>{ __( 'Loading session…' ) }</div>;
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
		<div className={ styles.root }>
			<SessionHeader summary={ data.summary } />
			<div ref={ scrollRef } className={ styles.scroll }>
				<div className={ clsx( styles.column, styles.conversationSpacing ) }>
					<Conversation
						data={ data }
						isRunning={ isRunning }
						startedAt={ startedAt }
						pendingQuestions={ pendingQuestionTexts }
						pendingAnswers={ pendingAnswers }
						onAnswerQuestion={ answerQuestion }
					/>
				</div>
			</div>
			<div className={ styles.composerOuter }>
				<div className={ styles.column }>
					<QueuedPrompts prompts={ queuedPrompts } onRemove={ removeQueuedPrompt } />
					<Composer
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						error={ runError }
						model={ currentModel }
						onModelChange={ onModelChange }
						onSend={ sendMessage }
						onInterrupt={ interrupt }
					/>
				</div>
			</div>
		</div>
	);
}
