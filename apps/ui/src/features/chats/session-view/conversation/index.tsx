import {
	getLocalMediaPath,
	getMediaAltText,
	getSafeMediaUrl,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import {
	isAiAccessRequiredError,
	isAiBlockedError,
	isOutOfCreditsError,
	isUsageCapError,
} from '@studio/common/ai/json-events';
import { formatUsageCapNotice } from '@studio/common/lib/studio-assistant-quota';
import { replaceEqualDeep } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import { AgentQuestionBatch } from '@/features/chats/session-view/conversation/agent-question';
import { canJoinBubbles } from '@/features/chats/session-view/conversation/joined';
import { AssistantText, UserTurn } from '@/features/chats/session-view/conversation/message';
import { ToolUseRow, TurnActivityLine } from '@/features/chats/session-view/conversation/trace';
import {
	entriesToTranscriptItems,
	getProgressMessage,
	getSender,
} from '@/features/chats/session-view/conversation/transcript-items';
import { AiAccessRequiredNotice, AiBlockedNotice } from '@/features/credits';
import styles from './style.module.css';
import type { LoadedAiSession } from '@/data/core';
import type { TranscriptItem } from '@/features/chats/session-view/conversation/transcript-items';

const ChatArtifact = memo( function ChatArtifact( {
	widgets,
}: {
	widgets: StudioChatArtifactWidgetDraft[];
} ) {
	return (
		<div className={ styles.mediaArtifacts }>
			{ widgets.map( ( widget, index ) => (
				<MediaArtifactImage key={ `${ widget.type }:${ index }` } widget={ widget } />
			) ) }
		</div>
	);
} );

function MediaArtifactImage( { widget }: { widget: StudioChatArtifactWidgetDraft } ) {
	const localPath = getLocalMediaPath( widget );
	const safeUrl = getSafeMediaUrl( widget );
	const localFileQuery = useLocalMediaDataUrl( localPath );

	const src = localPath ? localFileQuery.data ?? null : safeUrl;

	if ( src ) {
		return (
			<img
				className={ styles.mediaArtifactImage }
				src={ src }
				alt={ getMediaAltText( widget, __( 'Image' ) ) }
			/>
		);
	}
	return (
		<div className={ styles.marker } role="status">
			{ localFileQuery.isError || ! localPath
				? __( 'Image could not load' )
				: __( 'Loading image…' ) }
		</div>
	);
}

// In-flow marker for a turn that ended in an error. The proxy's quota
// refusals get dedicated copy instead of the raw provider message: the
// monthly usage cap shows the reset date once the quota query resolves.
const TurnErrorMarker = memo( function TurnErrorMarker( { message }: { message: string } ) {
	const isUsageCap = isUsageCapError( message );
	const isAccessRequired = isAiAccessRequiredError( message );
	const { data: quota } = useStudioAssistantQuota( { enabled: isUsageCap || isAccessRequired } );

	// Out of credits says nothing here: the purchase card has already taken
	// the composer's place, and repeating it in the transcript is noise.
	if ( isOutOfCreditsError( message ) ) {
		return null;
	}
	let text: ReactNode;
	if ( isAiBlockedError( message ) ) {
		text = <AiBlockedNotice />;
	} else if ( isAccessRequired ) {
		text = <AiAccessRequiredNotice quota={ quota } />;
	} else if ( isUsageCap ) {
		text = formatUsageCapNotice( quota?.costResetDate );
	} else {
		text = message || __( 'Something went wrong and this turn was stopped. Please try again.' );
	}
	return (
		<div className={ styles.marker } role="alert">
			{ text }
		</div>
	);
} );

// Keeps the previous render's items wherever they are unchanged, so a
// streaming update re-renders only the rows it touched.
function useStableItems< T >( value: T ): T {
	const [ stable, setStable ] = useState( value );
	const next = replaceEqualDeep( stable, value );
	if ( next !== stable ) {
		setStable( next );
	}
	return next;
}

export const Conversation = memo( function Conversation( {
	data,
	isRunning,
	startedAt,
	pendingQuestions,
	pendingAnswers,
	freeFormQuestion,
	onAnswerQuestion,
	onChooseFreeForm,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	// Question whose "Something else" option is armed; its answer arrives from
	// the composer rather than from an option click.
	freeFormQuestion: string | null;
	onAnswerQuestion: ( question: string, label: string ) => void;
	onChooseFreeForm: ( question: string ) => void;
} ) {
	const entries = data.entries;
	const items = useStableItems(
		useMemo(
			() => entriesToTranscriptItems( entries, { running: isRunning, startedAt } ),
			[ entries, isRunning, startedAt ]
		)
	);
	const progressMessage = useMemo( () => getProgressMessage( entries ), [ entries ] );

	const renderItems = ( rows: TranscriptItem[], visibleRows = rows ): ReactNode =>
		rows.map( ( item ) => {
			const index = visibleRows.indexOf( item );
			const joined = {
				joinedAbove: canJoinBubbles( item, visibleRows[ index - 1 ] ),
				joinedBelow: canJoinBubbles( item, visibleRows[ index + 1 ] ),
			};
			switch ( item.kind ) {
				case 'user-text':
					return (
						<UserTurn
							key={ item.key }
							text={ item.text }
							attachments={ item.attachments }
							annotation={ item.annotation }
							{ ...joined }
						/>
					);
				case 'assistant-text':
					return (
						<AssistantText
							key={ item.key }
							text={ item.text }
							messageText={ item.messageText }
							copyText={ item.copyText }
							streaming={ item.streaming }
							{ ...joined }
						/>
					);
				case 'tool-use':
					return (
						<ToolUseRow
							key={ item.key }
							name={ item.name }
							input={ item.input }
							result={ item.result }
							isRunning={ item.running ?? false }
						/>
					);
				case 'agent-question-batch':
					return (
						<AgentQuestionBatch
							key={ item.key }
							questions={ item.questions }
							pendingQuestions={ pendingQuestions }
							pendingAnswers={ pendingAnswers }
							freeFormQuestion={ freeFormQuestion }
							onAnswer={ onAnswerQuestion }
							onChooseFreeForm={ onChooseFreeForm }
							{ ...joined }
						/>
					);
				case 'chat-artifact':
					return <ChatArtifact key={ item.key } widgets={ item.widgets } />;
				case 'activity':
					return (
						<TurnActivityLine
							key={ item.key }
							activity={ item }
							waitingOnUser={ item.status === 'running' && pendingQuestions.size > 0 }
							progressMessage={ item.status === 'running' ? progressMessage : null }
							renderItems={ ( activityItems, visibleItems ) => (
								<div className={ styles.activityItems }>
									{ renderItems( activityItems, visibleItems ) }
								</div>
							) }
						/>
					);
				case 'error-marker':
					return <TurnErrorMarker key={ item.key } message={ item.message } />;
			}
		} );
	const groups: Array< { sender: ReturnType< typeof getSender >; items: TranscriptItem[] } > = [];
	for ( const item of items ) {
		const sender = getSender( item );
		const previous = groups[ groups.length - 1 ];
		if ( previous?.sender === sender ) {
			previous.items.push( item );
		} else {
			groups.push( { sender, items: [ item ] } );
		}
	}
	return (
		<div className={ styles.root }>
			{ groups.map( ( group ) => (
				<div
					key={ group.items[ 0 ].key }
					className={ styles.speakerGroup }
					data-speaker={ group.sender }
				>
					{ renderItems( group.items ) }
				</div>
			) ) }
		</div>
	);
} );
