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
// monthly usage cap shows the reset date once the quota query resolves, and
// out-of-credits (STU-2236) points at buying credits — waiting doesn't fix
// that one.
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

	return (
		<div className={ styles.root }>
			{ items.map( ( item, index ) => {
				const sender = getSender( item );
				const joined = {
					joinedAbove: !! sender && getSender( items[ index - 1 ] ) === sender,
					joinedBelow: !! sender && getSender( items[ index + 1 ] ) === sender,
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
							/>
						);
					case 'interrupted-marker':
						return (
							<div key={ item.key } className={ styles.marker } role="status">
								{ __( 'Interrupted by you' ) }
							</div>
						);
					case 'error-marker':
						return <TurnErrorMarker key={ item.key } message={ item.message } />;
					default:
						return null;
				}
			} ) }
		</div>
	);
} );
