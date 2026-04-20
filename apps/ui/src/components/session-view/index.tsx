import { isAssistantSdkMessage, isTextBlock, isToolUseBlock } from '@studio/common/ai/sdk-messages';
import { filterEventsAfterLastClear } from '@studio/common/ai/sessions/filter-events';
import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import {
	extractToolResultsFromUserMessage,
	getToolDetail,
	getToolDisplayName,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { SiteDropdown } from '@/components/site-dropdown';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useSession } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { AiSessionEvent, AiSessionSummary, LoadedAiSession } from '@/data/core';

type RenderItem =
	| { kind: 'user-text'; key: string; text: string }
	| { kind: 'assistant-text'; key: string; text: string }
	| {
			kind: 'tool-use';
			key: string;
			name: string;
			input?: Record< string, unknown >;
			result?: NormalizedToolResult;
	  }
	| {
			kind: 'agent-question';
			key: string;
			question: string;
			options: Array< { label: string; description: string } >;
	  };

function eventsToRenderItems( events: AiSessionEvent[] ): RenderItem[] {
	const relevant = filterEventsAfterLastClear( events );

	// First pass: collect tool_use → tool_result pairings from user-type SDK
	// messages so render items can attach output inline.
	const resultsByToolUseId = new Map< string, NormalizedToolResult >();
	for ( const event of relevant ) {
		if ( event.type !== 'sdk.message' ) {
			continue;
		}
		const msg = event.message as { type?: string } | null;
		if ( ! msg || msg.type !== 'user' ) {
			continue;
		}
		for ( const [ id, result ] of extractToolResultsFromUserMessage( msg ) ) {
			resultsByToolUseId.set( id, result );
		}
	}

	const items: RenderItem[] = [];
	relevant.forEach( ( event, eventIndex ) => {
		switch ( event.type ) {
			case 'user.message': {
				if ( event.source !== 'prompt' ) {
					return;
				}
				items.push( {
					kind: 'user-text',
					key: `${ eventIndex }:user`,
					text: event.text,
				} );
				return;
			}
			case 'sdk.message': {
				if ( ! isAssistantSdkMessage( event.message ) ) {
					return;
				}
				event.message.message.content.forEach( ( block, blockIndex ) => {
					if ( isTextBlock( block ) ) {
						const text = block.text.trim();
						if ( text ) {
							items.push( {
								kind: 'assistant-text',
								key: `${ eventIndex }:${ blockIndex }:text`,
								text,
							} );
						}
					} else if ( isToolUseBlock( block ) ) {
						items.push( {
							kind: 'tool-use',
							key: `${ eventIndex }:${ blockIndex }:tool`,
							name: block.name,
							input: block.input,
							result: resultsByToolUseId.get( block.id ),
						} );
					}
				} );
				return;
			}
			case 'agent.question': {
				items.push( {
					kind: 'agent-question',
					key: `${ eventIndex }:question`,
					question: event.question,
					options: event.options,
				} );
				return;
			}
			default:
				return;
		}
	} );

	return items;
}

function SessionHeader( { summary }: { summary: AiSessionSummary } ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const { data: sites } = useSites();
	if ( ! siteName ) {
		return null;
	}

	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );

	// Reserve a no-drag area at the left so the floating sidebar-toggle button
	// (collapsed state) doesn't sit on top of the header's drag region.
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

function UserTurn( { text }: { text: string } ) {
	return (
		<div className={ styles.userTurn }>
			<div className={ styles.userText }>{ text }</div>
		</div>
	);
}

function AssistantText( { text }: { text: string } ) {
	return <Markdown>{ text }</Markdown>;
}

const TOOL_RESULT_PREVIEW_MAX_LINES = 12;

function ToolUseRow( {
	name,
	input,
	result,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
} ) {
	const label = getToolDisplayName( name );
	const detail = getToolDetail( name, input );
	const [ expanded, setExpanded ] = useState( false );
	const resultText = result?.text?.trim() ?? '';
	const hasOutput = resultText.length > 0;
	const isLong = resultText.split( '\n' ).length > TOOL_RESULT_PREVIEW_MAX_LINES;

	return (
		<div className={ styles.toolBlock }>
			<div className={ styles.toolRow }>
				<span className={ styles.toolLabel }>{ label }</span>
				{ detail ? <span className={ styles.toolDetail }>{ detail }</span> : null }
			</div>
			{ hasOutput ? (
				<div className={ styles.toolOutputWrap }>
					<pre
						className={ clsx(
							styles.toolOutput,
							result?.isError && styles.toolOutputError,
							! expanded && isLong && styles.toolOutputCollapsed
						) }
					>
						{ resultText }
					</pre>
					{ isLong ? (
						<button
							type="button"
							className={ styles.toolOutputToggle }
							onClick={ () => setExpanded( ( prev ) => ! prev ) }
						>
							{ expanded ? __( 'Show less' ) : __( 'Show more' ) }
						</button>
					) : null }
				</div>
			) : null }
		</div>
	);
}

function AgentQuestion( {
	question,
	options,
	isInteractive,
	pickedLabel,
	onAnswer,
}: {
	question: string;
	options: Array< { label: string; description: string } >;
	isInteractive: boolean;
	pickedLabel: string | undefined;
	onAnswer: ( label: string ) => void;
} ) {
	return (
		<div className={ styles.question }>
			<p className={ styles.questionText }>{ question }</p>
			{ options.length > 0 ? (
				<ul className={ styles.questionOptions }>
					{ options.map( ( option, index ) => {
						const picked = option.label === pickedLabel;
						return (
							<li key={ index }>
								<button
									type="button"
									className={ clsx(
										styles.questionOption,
										picked && styles.questionOptionPicked
									) }
									disabled={ ! isInteractive }
									onClick={ () => onAnswer( option.label ) }
									title={ option.description }
								>
									{ option.label }
								</button>
							</li>
						);
					} ) }
				</ul>
			) : null }
		</div>
	);
}

function ThinkingIndicator( {
	active,
	startedAt,
	progressMessage,
}: {
	active: boolean;
	startedAt: number | null;
	progressMessage: string | null;
} ) {
	const [ message, setMessage ] = useState( () => randomThinkingMessage() );
	const [ elapsedSeconds, setElapsedSeconds ] = useState( 0 );

	useEffect( () => {
		if ( ! active || startedAt === null ) {
			return;
		}
		setMessage( randomThinkingMessage() );
		setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		const labelInterval = window.setInterval( () => {
			setMessage( randomThinkingMessage() );
		}, 4000 );
		const tickInterval = window.setInterval( () => {
			setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		}, 1000 );
		return () => {
			window.clearInterval( labelInterval );
			window.clearInterval( tickInterval );
		};
	}, [ active, startedAt ] );

	// Always mounted so its reserved height keeps the composer from shifting
	// up when a run ends.
	return (
		<div className={ styles.thinkingRow } role="status" aria-live="polite">
			{ active ? (
				<>
					<div className={ styles.thinkingHead }>
						<span className={ styles.thinkingDot } aria-hidden="true" />
						<span className={ styles.thinkingLabel }>{ message }</span>
						{ elapsedSeconds > 0 ? (
							<span className={ styles.thinkingElapsed }>{ `${ elapsedSeconds }s` }</span>
						) : null }
					</div>
					{ progressMessage ? (
						<span className={ styles.thinkingProgress }>{ progressMessage }</span>
					) : null }
				</>
			) : null }
		</div>
	);
}

// Progress from earlier turns must not leak into the current indicator, so
// the scan stops at the nearest turn boundary.
function findLatestProgressMessage( events: AiSessionEvent[] ): string | null {
	for ( let i = events.length - 1; i >= 0; i-- ) {
		const event = events[ i ];
		if ( event.type === 'user.message' || event.type === 'turn.closed' ) {
			return null;
		}
		if ( event.type === 'tool.progress' ) {
			return event.message;
		}
	}
	return null;
}

function Conversation( {
	data,
	isRunning,
	startedAt,
	pendingQuestions,
	pendingAnswers,
	onAnswerQuestion,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	onAnswerQuestion: ( question: string, label: string ) => void;
} ) {
	const items = useMemo( () => eventsToRenderItems( data.events ), [ data.events ] );
	const progressMessage = useMemo(
		() => ( isRunning ? findLatestProgressMessage( data.events ) : null ),
		[ data.events, isRunning ]
	);

	return (
		<div className={ styles.conversation }>
			{ items.map( ( item ) => {
				switch ( item.kind ) {
					case 'user-text':
						return <UserTurn key={ item.key } text={ item.text } />;
					case 'assistant-text':
						return <AssistantText key={ item.key } text={ item.text } />;
					case 'tool-use':
						return (
							<ToolUseRow
								key={ item.key }
								name={ item.name }
								input={ item.input }
								result={ item.result }
							/>
						);
					case 'agent-question':
						return (
							<AgentQuestion
								key={ item.key }
								question={ item.question }
								options={ item.options }
								isInteractive={ pendingQuestions.has( item.question ) }
								pickedLabel={ pendingAnswers[ item.question ] }
								onAnswer={ ( label ) => onAnswerQuestion( item.question, label ) }
							/>
						);
					default:
						return null;
				}
			} ) }
			<ThinkingIndicator
				active={ isRunning && pendingQuestions.size === 0 }
				startedAt={ startedAt }
				progressMessage={ progressMessage }
			/>
		</div>
	);
}

interface ComposerProps {
	isRunning: boolean;
	error: string | null;
	onSend: ( prompt: string ) => Promise< void >;
	onInterrupt: () => Promise< void >;
}

function Composer( { isRunning, error, onSend, onInterrupt }: ComposerProps ) {
	const [ value, setValue ] = useState( '' );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( ! trimmed || isRunning ) {
			return;
		}
		setValue( '' );
		try {
			await onSend( trimmed );
		} catch {
			// Restore the draft so the user can retry; the parent surfaces the
			// error message via `error`.
			setValue( trimmed );
		}
	}, [ value, isRunning, onSend ] );

	return (
		<div className={ styles.composer }>
			<div className={ styles.composerInner }>
				<textarea
					className={ styles.composerInput }
					placeholder={ __( 'Set your next instruction…' ) }
					value={ value }
					onChange={ ( event ) => setValue( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
							event.preventDefault();
							void send();
						}
					} }
					disabled={ isRunning }
					rows={ 3 }
				/>
				<div className={ styles.composerFooter }>
					{ error ? <span className={ styles.composerError }>{ error }</span> : null }
					<div className={ styles.composerActions }>
						{ isRunning ? (
							<button
								type="button"
								className={ styles.composerButton }
								onClick={ () => void onInterrupt() }
							>
								{ __( 'Stop' ) }
							</button>
						) : (
							<button
								type="button"
								className={ styles.composerButton }
								onClick={ () => void send() }
								disabled={ ! value.trim() }
							>
								{ __( 'Send' ) }
							</button>
						) }
					</div>
				</div>
			</div>
		</div>
	);
}

export function SessionView( { sessionId }: { sessionId: string } ) {
	const { data, isLoading, error } = useSession( sessionId );
	const {
		isRunning,
		hasActiveRun,
		startedAt,
		error: runError,
		pendingQuestions,
		pendingAnswers,
		sendMessage,
		interrupt,
		answerQuestion,
	} = useAgentRun( sessionId );
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
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
	}, [ sessionId, data, isRunning ] );

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
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ startedAt }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					onAnswerQuestion={ answerQuestion }
				/>
			</div>
			<Composer
				isRunning={ hasActiveRun || pendingQuestions.length > 0 }
				error={ runError }
				onSend={ sendMessage }
				onInterrupt={ interrupt }
			/>
		</div>
	);
}
