import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Composer } from '@/components/session-view/composer';
import { Conversation } from '@/components/session-view/conversation';
import { QueuedPrompts } from '@/components/session-view/queued-prompts';
import { SiteDropdown } from '@/components/site-dropdown';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useSession } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

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
						onSend={ sendMessage }
						onInterrupt={ interrupt }
					/>
				</div>
			</div>
		</div>
	);
}
