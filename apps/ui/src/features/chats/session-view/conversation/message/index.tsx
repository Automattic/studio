import { AttachmentChip } from '@studio/ds';
import { AttachmentIcon, CodeIcon } from '@studio/ds/icons';
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

export const UserTurn = memo( function UserTurn( {
	text,
	attachments,
	annotation,
	...joined
}: {
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
			{ ...joinedAttributes( joined ) }
			{ ...{ [ MESSAGE_TEXT_ATTRIBUTE ]: text, [ SCROLL_ANCHOR_ATTRIBUTE ]: '' } }
		>
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
					<CopyButton
						className={ styles.messageActions }
						size="icon-2xs"
						text={ text }
						label={ __( 'Copy message' ) }
					/>
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
	text,
	messageText,
	copyText,
	streaming,
	...joined
}: {
	text: string;
	messageText: string;
	copyText?: string;
	streaming?: boolean;
} & Joined ) {
	return (
		<div
			className={ styles.assistantTurn }
			{ ...joinedAttributes( joined ) }
			{ ...{
				[ MESSAGE_TEXT_ATTRIBUTE ]: messageText,
				[ QUOTABLE_TEXT_ATTRIBUTE ]: true,
			} }
		>
			<div className={ styles.assistantBubble } { ...joinedAttributes( joined ) }>
				<Markdown streaming={ streaming }>{ text }</Markdown>
			</div>
			{ copyText ? (
				<CopyButton
					className={ styles.messageActions }
					size="icon-2xs"
					text={ copyText }
					label={ __( 'Copy message' ) }
				/>
			) : null }
		</div>
	);
} );
