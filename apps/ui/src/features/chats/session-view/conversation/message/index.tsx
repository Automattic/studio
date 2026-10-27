import { __ } from '@wordpress/i18n';
import { FileTextIcon, ImageIcon } from 'lucide-react';
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
import type { StudioChatAttachmentSummary } from '@studio/common/ai/sessions/entry-types';
import type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';

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
	return (
		<div
			className={ styles.userTurn }
			{ ...joinedAttributes( joined ) }
			{ ...{ [ MESSAGE_TEXT_ATTRIBUTE ]: text, [ SCROLL_ANCHOR_ATTRIBUTE ]: '' } }
		>
			{ text || attachments?.length ? (
				<div className={ styles.userTextRow }>
					{ text ? (
						<CopyButton
							className={ styles.messageActions }
							size="icon-sm"
							text={ text }
							label={ __( 'Copy message' ) }
						/>
					) : null }
					<div className={ styles.userText } data-side="user" { ...joinedAttributes( joined ) }>
						{ text ? <div className={ styles.userTextBody }>{ text }</div> : null }
						{ attachments?.length ? (
							<ul className={ styles.userAttachments }>
								{ attachments.map( ( attachment, index ) => (
									<li key={ `${ attachment.name }:${ index }` } className={ styles.userAttachment }>
										<span className={ styles.userAttachmentPreview }>
											{ attachment.kind === 'image' && attachment.previewDataUrl ? (
												<img src={ attachment.previewDataUrl } alt="" />
											) : attachment.kind === 'image' ? (
												<ImageIcon />
											) : (
												<FileTextIcon />
											) }
										</span>
										<span className={ styles.userAttachmentName } title={ attachment.name }>
											{ attachment.name }
										</span>
									</li>
								) ) }
							</ul>
						) : null }
					</div>
				</div>
			) : null }
			{ annotation?.elementLabel || annotation?.tag ? (
				<div className={ styles.annotationAttachment }>
					<span className={ styles.annotationElementTag }>
						{ annotation.elementLabel ?? `<${ annotation.tag }>` }
					</span>
					{ annotation.nearbyText ? (
						<span className={ styles.annotationElementText }>{ annotation.nearbyText }</span>
					) : null }
				</div>
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
					size="icon-sm"
					text={ copyText }
					label={ __( 'Copy message' ) }
				/>
			) : null }
		</div>
	);
} );
