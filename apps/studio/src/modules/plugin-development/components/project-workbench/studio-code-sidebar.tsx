import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { QueryClientProvider } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from 'src/components/button';
import { Composer } from 'src/components/studio-code-session/composer';
import { queryClient } from 'src/components/studio-code-session/query-client';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import { isInternalAiReviewChatMessage } from './agent-event-messages';
import { ChatMarkdown } from './chat-markdown';
import {
	PLUGIN_DEVELOPMENT_SLASH_COMMANDS,
	getDevelopmentChatSessionTitle,
	getPatchStats,
} from './utils';
import type { AiPatchItem, DevelopmentChatExample, DevelopmentChatMessage } from './types';
import type { ComposerSendAttachments } from 'src/components/studio-code-session/composer/use-composer-attachments';

function EmptyChatState( {
	examples,
	disabled,
	onPreviewPrompt,
	onClearPreview,
	onSelectPrompt,
}: {
	examples: DevelopmentChatExample[];
	disabled: boolean;
	onPreviewPrompt: ( prompt: string ) => void;
	onClearPreview: () => void;
	onSelectPrompt: ( prompt: string ) => void;
} ) {
	return (
		<div className={ workbenchStyles.chatEmptyState }>
			<div className={ workbenchStyles.chatEmptyPrompt }>
				{ __( 'Ask Studio Code anything to get started.' ) }
			</div>
			<div className={ workbenchStyles.chatExamples }>
				{ examples.map( ( example ) => (
					<button
						key={ example.id }
						type="button"
						className={ workbenchStyles.chatExampleButton }
						title={ example.prompt }
						disabled={ disabled }
						onMouseEnter={ () => onPreviewPrompt( example.prompt ) }
						onMouseLeave={ onClearPreview }
						onFocus={ () => onPreviewPrompt( example.prompt ) }
						onBlur={ onClearPreview }
						onClick={ () => onSelectPrompt( example.prompt ) }
					>
						{ example.label }
					</button>
				) ) }
			</div>
		</div>
	);
}

function ChatMessage( { message }: { message: DevelopmentChatMessage } ) {
	if ( message.role === 'user' ) {
		return (
			<div className={ cx( workbenchStyles.chatMessage, workbenchStyles.chatMessageUser ) }>
				<div className={ workbenchStyles.chatUserBubble }>{ message.content }</div>
			</div>
		);
	}

	return (
		<div className={ workbenchStyles.chatAssistantMessage }>
			<ChatMarkdown>{ message.content }</ChatMarkdown>
		</div>
	);
}

function ProposedChangesArtifact( {
	patches,
	selectedPatch,
	onSelectPatch,
}: {
	patches: AiPatchItem[];
	selectedPatch: AiPatchItem | null;
	onSelectPatch: ( patchId: string ) => void;
} ) {
	if ( patches.length === 0 ) {
		return null;
	}

	return (
		<div className={ workbenchStyles.chatArtifact }>
			<div className={ workbenchStyles.sectionHeader }>
				<h3>{ __( 'Proposed changes' ) }</h3>
				<span>{ patches.length }</span>
			</div>
			<div className={ workbenchStyles.patchList }>
				{ patches.map( ( patch ) => {
					const stats = getPatchStats( patch );
					return (
						<button
							key={ patch.id }
							type="button"
							className={ cx(
								workbenchStyles.patchItem,
								selectedPatch?.id === patch.id && workbenchStyles.patchItemActive
							) }
							onClick={ () => onSelectPatch( patch.id ) }
						>
							<span>
								<strong>{ patch.path }</strong>
								<em>{ patch.status }</em>
							</span>
							<small>
								+{ stats.added } -{ stats.deleted }
							</small>
						</button>
					);
				} ) }
			</div>
		</div>
	);
}

export function StudioCodeSidebar( {
	projectId,
	messages,
	examples,
	isRunning,
	error,
	statusMessage,
	hasUnsavedChanges,
	isBlocked,
	patches,
	selectedPatch,
	onSend,
	onClearConversation,
	onSelectPatch,
}: {
	projectId: string;
	messages: DevelopmentChatMessage[];
	examples: DevelopmentChatExample[];
	isRunning: boolean;
	error: string | null;
	statusMessage: string | null;
	hasUnsavedChanges: boolean;
	isBlocked: boolean;
	patches: AiPatchItem[];
	selectedPatch: AiPatchItem | null;
	onSend: ( prompt: string, attachments: ComposerSendAttachments ) => Promise< void >;
	onClearConversation: () => void;
	onSelectPatch: ( patchId: string ) => void;
} ) {
	const [ draftPrompt, setDraftPrompt ] = useState< { id: number; prompt: string } | null >( null );
	const [ previewPrompt, setPreviewPrompt ] = useState< string | null >( null );
	const timelineRef = useRef< HTMLDivElement | null >( null );
	const draftPromptIdRef = useRef( 0 );
	const disabled = hasUnsavedChanges || isBlocked;
	const visibleMessages = useMemo(
		() =>
			messages.filter(
				( message ) =>
					message.role !== 'assistant' || ! isInternalAiReviewChatMessage( message.content )
			),
		[ messages ]
	);
	const sessionTitle = useMemo(
		() => getDevelopmentChatSessionTitle( visibleMessages ),
		[ visibleMessages ]
	);
	const hasConversation = visibleMessages.length > 0;
	const showEmptyState = visibleMessages.length === 0 && patches.length === 0 && ! isRunning;

	const selectPrompt = useCallback( ( prompt: string ) => {
		draftPromptIdRef.current += 1;
		setDraftPrompt( { id: draftPromptIdRef.current, prompt } );
	}, [] );

	useEffect( () => {
		const timeline = timelineRef.current;
		if ( ! timeline ) {
			return;
		}

		requestAnimationFrame( () => {
			timeline.scrollTo( { top: timeline.scrollHeight } );
		} );
	}, [ visibleMessages.length, patches.length, selectedPatch?.id, isRunning ] );

	return (
		<div className={ workbenchStyles.chatSidebarPane }>
			{ hasConversation && (
				<div className={ workbenchStyles.chatSidebarHeader }>
					<div className={ workbenchStyles.chatSidebarTitle } title={ sessionTitle }>
						<span>{ sessionTitle }</span>
					</div>
					<Button
						variant="icon"
						icon={ trash }
						iconSize={ 18 }
						aria-label={ __( 'Clear conversation history' ) }
						tooltipText={ __( 'Clear conversation history' ) }
						disabled={ isRunning }
						onClick={ onClearConversation }
					/>
				</div>
			) }
			<div ref={ timelineRef } className={ workbenchStyles.chatTimeline }>
				{ showEmptyState ? (
					<EmptyChatState
						examples={ examples }
						disabled={ disabled }
						onPreviewPrompt={ setPreviewPrompt }
						onClearPreview={ () => setPreviewPrompt( null ) }
						onSelectPrompt={ selectPrompt }
					/>
				) : (
					visibleMessages.map( ( message ) => (
						<ChatMessage key={ message.id } message={ message } />
					) )
				) }
				{ isRunning && (
					<div className={ workbenchStyles.chatAssistantMessage }>
						<div className={ workbenchStyles.chatThinking }>
							{ statusMessage || __( 'Studio Code is working…' ) }
						</div>
					</div>
				) }
				<ProposedChangesArtifact
					patches={ patches }
					selectedPatch={ selectedPatch }
					onSelectPatch={ onSelectPatch }
				/>
			</div>

			<div className={ workbenchStyles.chatComposerDock }>
				{ hasUnsavedChanges && (
					<div className={ workbenchStyles.aiStatus }>
						{ __( 'Save the current draft before running Studio Code.' ) }
					</div>
				) }
				{ patches.length > 0 && (
					<div className={ workbenchStyles.chatComposerActions }>
						<span>
							{ sprintf(
								// translators: %d is the number of file patches proposed by Studio Code.
								__( '%d proposed' ),
								patches.length
							) }
						</span>
					</div>
				) }
				<QueryClientProvider client={ queryClient }>
					<div className={ workbenchStyles.composerWrap }>
						<Composer
							busy={ isRunning }
							error={ error }
							model={ DEFAULT_MODEL }
							onSend={ onSend }
							onInterrupt={ async () => undefined }
							sessionId={ `development-project:${ projectId }` }
							entries={ [] }
							draftPrompt={ draftPrompt }
							previewPrompt={ previewPrompt }
							placeholder={ __( 'Ask Studio Code to edit this plugin…' ) }
							hideModelPicker
							showMetaUses={ false }
							disabled={ disabled }
							slashCommands={ PLUGIN_DEVELOPMENT_SLASH_COMMANDS }
						/>
					</div>
				</QueryClientProvider>
			</div>
		</div>
	);
}
