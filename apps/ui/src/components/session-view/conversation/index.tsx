import { isAssistantSdkMessage, isTextBlock, isToolUseBlock } from '@studio/common/ai/sdk-messages';
import { filterEventsAfterLastClear } from '@studio/common/ai/sessions/filter-events';
import {
	extractToolResultsFromUserMessage,
	getToolDetail,
	getToolDisplayName,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { ThinkingIndicator } from '@/components/session-view/thinking-indicator';
import styles from './style.module.css';
import type { AiSessionEvent, LoadedAiSession } from '@/data/core';

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
	  }
	| { kind: 'interrupted-marker'; key: string };

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
			case 'turn.closed': {
				if ( event.status === 'interrupted' ) {
					items.push( {
						kind: 'interrupted-marker',
						key: `${ eventIndex }:interrupted`,
					} );
				}
				return;
			}
			default:
				return;
		}
	} );

	return items;
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
									className={ clsx( styles.questionOption, picked && styles.questionOptionPicked ) }
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

export function Conversation( {
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
		<div className={ styles.root }>
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
					case 'interrupted-marker':
						return (
							<div key={ item.key } className={ styles.interruptedMarker } role="status">
								{ __( 'Interrupted by you' ) }
							</div>
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
