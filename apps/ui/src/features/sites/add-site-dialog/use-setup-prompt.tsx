import {
	getEffectiveSessionProvider,
	resolveSessionModelForProvider,
} from '@studio/agent/protocol/providers';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { canUsePaidAiModels } from '@studio/common/lib/studio-assistant-quota';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { PaperclipIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { openNewSession, SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import {
	toComposerSendAttachments,
	useComposerAttachments,
	useFileDrop,
} from '@/data/use-composer-attachments';
import {
	getComposerDraft,
	pendingPromptSlot,
	saveComposerDraft,
	useComposerNotice,
} from '@/features/composer';
import {
	Alert,
	AlertDescription,
	AlertTitle,
	AttachmentChip,
	AttachmentRemoveButton,
	Button,
	DropOverlay,
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	IconButton,
	InputGroup,
	InputGroupTextarea,
} from '@/lib/ui';
import { useAddSite } from './context';
import styles from './style.module.css';
import type { SetupBrief } from './context';

export function useSetupPrompt( { enabled = true, busy = false } = {} ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { setProgress, formActions, briefDraftKey, createdSite, setCreatedSite } = useAddSite();
	const inputId = useId();
	const fileInput = useRef< HTMLInputElement >( null );
	const brief = useRef< SetupBrief | null >( null );
	const [ initialDraft ] = useState( () => getComposerDraft( briefDraftKey ) );
	const [ text, setText ] = useState( initialDraft.text );
	const {
		attachments,
		addFiles,
		removeAttachment,
		pasteHandlers,
		error: attachmentError,
	} = useComposerAttachments( initialDraft.attachments );
	useEffect( () => {
		saveComposerDraft( briefDraftKey, { text, attachments } );
	}, [ briefDraftKey, text, attachments ] );
	const [ dropTarget, setDropTarget ] = useState< HTMLDivElement | null >( null );
	const attachFiles = useCallback( ( files: FileList ) => void addFiles( files ), [ addFiles ] );
	const dragging = useFileDrop( busy ? null : dropTarget, attachFiles );
	const [ retrying, setRetrying ] = useState( false );
	const { data: settings } = useAiSettings();
	const { data: quota } = useStudioAssistantQuota();
	const { data: user } = useAuthUser();
	const provider = getEffectiveSessionProvider( [], settings );
	const notice = useComposerNotice( provider );
	const providerConnected = provider === 'wpcom' ? !! user : !! settings?.hasAnthropicApiKey;
	const model = resolveSessionModelForProvider( [], provider, {
		canUsePaidModels: canUsePaidAiModels( quota, user?.email ),
	} );
	const openSite = ( siteId: string ) =>
		navigate( { to: '/sites/$siteId/new', params: { siteId } } );
	const startChat = async ( created = createdSite ) => {
		if ( ! created?.brief ) return;
		let chatId = created.chatId;
		setRetrying( true );
		setProgress( __( 'Starting chat…' ) );
		try {
			chatId ??= ( await openNewSession( { connector, queryClient }, created.siteId ) ).id;
			setCreatedSite( { ...created, chatId } );
			await connector.setSessionProvider( chatId, provider, model );
			queryClient.setQueryData(
				[ ...SESSIONS_QUERY_KEY, chatId ],
				await connector.getSession( chatId )
			);
			pendingPromptSlot.set( {
				sessionId: chatId,
				prompt:
					created.brief.prompt || __( 'Build this site using the attached files as references.' ),
				attachments: created.brief.attachments,
			} );
			await navigate( { to: '/sessions/$sessionId', params: { sessionId: chatId } } );
		} catch ( failure ) {
			setCreatedSite( {
				...created,
				chatId,
				error: {
					title: __( 'Your site was created, but the AI chat could not start.' ),
					message: __( 'Try starting the chat again, or open your site.' ),
					details: getErrorMessage( failure ),
				},
			} );
		} finally {
			setProgress( null );
			setRetrying( false );
		}
	};
	const actions = (
		<>
			<Button
				variant="outline"
				disabled={ retrying }
				onClick={ () => createdSite && void openSite( createdSite.siteId ) }
			>
				{ __( 'Open site' ) }
			</Button>
			<Button loading={ retrying } onClick={ () => void startChat() }>
				{ __( 'Try again' ) }
			</Button>
		</>
	);
	const recovery = createdSite?.error ? (
		<>
			<Alert variant="destructive">
				<AlertTitle>{ createdSite.error.title }</AlertTitle>
				<AlertDescription>{ createdSite.error.message }</AlertDescription>
			</Alert>
			{ formActions ? createPortal( actions, formActions ) : null }
		</>
	) : null;
	const field = enabled ? (
		<Field className={ styles.brief } hidden={ ! providerConnected } inert={ ! providerConnected }>
			<FieldLabel htmlFor={ inputId }>{ __( 'Instructions' ) }</FieldLabel>
			<InputGroup ref={ setDropTarget }>
				{ dragging && <DropOverlay>{ __( 'Drop to attach' ) }</DropOverlay> }
				{ attachments.length > 0 && (
					<ul className={ styles.briefAttachments } aria-label={ __( 'Attachments' ) }>
						{ attachments.map( ( attachment ) => (
							<AttachmentChip
								render={ <li /> }
								key={ attachment.id }
								aria-label={ attachment.name }
							>
								<PaperclipIcon aria-hidden="true" />
								<span className={ styles.briefAttachmentName }>{ attachment.name }</span>
								<AttachmentRemoveButton
									label={ __( 'Remove attachment' ) }
									disabled={ busy }
									onClick={ () => removeAttachment( attachment.id ) }
								/>
							</AttachmentChip>
						) ) }
					</ul>
				) }
				<InputGroupTextarea
					id={ inputId }
					className={ styles.briefTextarea }
					size="sm"
					rows={ 3 }
					value={ text }
					disabled={ busy }
					onChange={ ( event ) => setText( event.target.value ) }
					onPaste={ pasteHandlers.onPaste }
					placeholder={ __( 'Describe what you’d like to build or change (optional)…' ) }
				/>
				<div className={ styles.briefToolbar }>
					<IconButton
						icon={ <PaperclipIcon /> }
						label={ __( 'Attach files' ) }
						size="icon-sm"
						disabled={ busy }
						onClick={ () => fileInput.current?.click() }
					/>
					<input
						ref={ fileInput }
						type="file"
						multiple
						aria-label={ __( 'Upload attachments' ) }
						className={ styles.fileInput }
						disabled={ busy }
						onChange={ ( event ) => {
							if ( event.target.files ) attachFiles( event.target.files );
							event.target.value = '';
						} }
					/>
				</div>
			</InputGroup>
			{ attachmentError ? <FieldError role="alert">{ attachmentError }</FieldError> : null }
			{ notice && (
				<FieldDescription>
					{ notice.message }
					{ notice.action && (
						<>
							{ ' ' }
							<Button variant="inline-link" size="inline" onClick={ notice.action.onClick }>
								{ notice.action.label }
							</Button>
						</>
					) }
				</FieldDescription>
			) }
		</Field>
	) : null;
	return {
		field,
		recovery,
		hasCreatedSite: () => !! createdSite,
		capture: () => {
			const prompt = text.trim();
			brief.current =
				enabled && ( prompt || attachments.length )
					? { prompt, attachments: toComposerSendAttachments( attachments ) }
					: null;
			return !! brief.current;
		},
		finish: async ( siteId: string ) => {
			const created = { siteId, brief: brief.current };
			setCreatedSite( created );
			if ( created.brief ) await startChat( created );
			else await openSite( siteId );
		},
	};
}
