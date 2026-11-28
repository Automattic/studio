import { getMessagePreview, type ReplyReference } from '@studio/agent/protocol/reply-reference';
import { AttachmentChip, Button, IconButton } from '@studio/ds';
import { AttachmentIcon, CodeIcon, ReplyIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { memo } from 'react';
import { CopyButton } from '@/features/chats/copy-button';
import { Markdown } from '@/features/chats/markdown';
import { joinedAttributes, type Joined } from '@/features/chats/session-view/conversation/joined';
import { SCROLL_ANCHOR_ATTRIBUTE } from '@/features/chats/session-view/use-anchored-scroll';
import {
	MESSAGE_TEXT_ATTRIBUTE,
	QUOTABLE_TEXT_ATTRIBUTE,
} from '@/features/chats/use-text-context-menu';
import styles from './style.module.css';
import type { StudioChatAttachmentSummary } from '@studio/agent/protocol/sessions/entry-types';
import type { StudioVisualAnnotationSummary } from '@studio/agent/protocol/visual-annotations';

function MessageActions( { text, onReply }: { text?: string; onReply?: () => void } ) {
	if ( ! text && ! onReply ) return null;
	return (
		<div className={ styles.messageActions }>
			{ onReply ? (
				<IconButton
					variant="muted-ghost"
					size="icon-2xs"
					icon={ <ReplyIcon className={ styles.replyIcon } /> }
					label={ __( 'Reply' ) }
					onClick={ onReply }
				/>
			) : null }
			{ text ? <CopyButton size="icon-2xs" text={ text } label={ __( 'Copy message' ) } /> : null }
		</div>
	);
}

export const UserTurn = memo( function UserTurn( {
	entryId,
	reply,
	onReply,
	onOpenReply,
	text,
	attachments,
	annotation,
	...joined
}: {
	entryId?: string;
	reply?: ReplyReference;
	onReply?: () => void;
	onOpenReply?: ( reply: ReplyReference ) => void;
	text: string;
	attachments?: StudioChatAttachmentSummary[];
	annotation?: StudioVisualAnnotationSummary;
} & Joined ) {
	const hasElementReference = Boolean(
		annotation?.tag || ( annotation?.elementLabel && ! annotation.imageIds?.length )
	);
	const hasPhoto = attachments?.some(
		( attachment ) => attachment.kind === 'image' && attachment.previewDataUrl
	);
	return (
		<div
			className={ styles.userTurn }
			data-message-id={ entryId }
			{ ...joinedAttributes( joined ) }
			{ ...{ [ MESSAGE_TEXT_ATTRIBUTE ]: text, [ SCROLL_ANCHOR_ATTRIBUTE ]: '' } }
		>
			{ reply ? (
				<Button
					variant="outline"
					size="sm"
					shape="round"
					className={ styles.replyExcerpt }
					nativeButton={ false }
					role="link"
					render={
						<a
							href={ `/sessions/${ encodeURIComponent(
								reply.sessionId
							) }?message=${ encodeURIComponent( reply.entryId ) }` }
						/>
					}
					onClick={ ( event ) => {
						if (
							onOpenReply &&
							! ( event.metaKey || event.ctrlKey || event.shiftKey || event.altKey )
						) {
							event.preventDefault();
							onOpenReply( reply );
						}
					} }
					title={ getMessagePreview( reply.excerpt ) }
				>
					<span className={ styles.replyExcerptText }>{ getMessagePreview( reply.excerpt ) }</span>
				</Button>
			) : null }
			{ ! text ? <MessageActions onReply={ onReply } /> : null }
			{ attachments?.length ? (
				<ul className={ styles.userAttachments }>
					{ attachments.map( ( attachment, index ) =>
						attachment.kind === 'image' && attachment.previewDataUrl ? (
							<li
								key={ `${ attachment.name }:${ index }` }
								className={ styles.userImageAttachment }
								title={ attachment.name }
							>
								<img
									className={ styles.userImageAttachmentContent }
									src={ attachment.previewDataUrl }
									alt={ attachment.name }
								/>
							</li>
						) : (
							<AttachmentChip
								key={ `${ attachment.name }:${ index }` }
								render={ <li /> }
								className={ styles.userAttachment }
								title={ attachment.name }
							>
								<AttachmentIcon kind={ attachment.kind } mimeType={ attachment.mimeType } />
								<span className={ styles.userAttachmentName }>{ attachment.name }</span>
							</AttachmentChip>
						)
					) }
				</ul>
			) : null }
			{ text ? (
				<>
					<MessageActions text={ text } onReply={ onReply } />
					<div
						className={ styles.userText }
						data-side="user"
						{ ...joinedAttributes( { ...joined, joinedAbove: joined.joinedAbove || hasPhoto } ) }
					>
						<div className={ styles.userTextBody }>{ text }</div>
					</div>
				</>
			) : null }
			{ hasElementReference && annotation ? (
				<AttachmentChip
					className={ styles.annotationAttachment }
					font="mono"
					title={ [ annotation.elementLabel ?? `<${ annotation.tag }>`, annotation.nearbyText ]
						.filter( Boolean )
						.join( ' · ' ) }
				>
					<CodeIcon aria-hidden="true" />
					<span className={ styles.annotationElementTag }>
						{ annotation.elementLabel ?? `<${ annotation.tag }>` }
					</span>
					{ annotation.nearbyText ? (
						<span className={ styles.annotationElementText }>{ annotation.nearbyText }</span>
					) : null }
				</AttachmentChip>
			) : null }
		</div>
	);
} );

export const AssistantText = memo( function AssistantText( {
	entryId,
	onReply,
	text,
	messageText,
	copyText,
	streaming,
	...joined
}: {
	entryId?: string;
	onReply?: () => void;
	text: string;
	messageText: string;
	copyText?: string;
	streaming?: boolean;
} & Joined ) {
	return (
		<div
			className={ styles.assistantTurn }
			data-message-id={ entryId }
			{ ...joinedAttributes( joined ) }
			{ ...{
				[ MESSAGE_TEXT_ATTRIBUTE ]: messageText,
				[ QUOTABLE_TEXT_ATTRIBUTE ]: true,
			} }
		>
			<div className={ styles.assistantBubble } { ...joinedAttributes( joined ) }>
				<Markdown streaming={ streaming }>{ text }</Markdown>
			</div>
			<MessageActions text={ copyText } onReply={ onReply } />
		</div>
	);
} );
