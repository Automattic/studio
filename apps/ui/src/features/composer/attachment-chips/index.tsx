import {
	formatComposerAttachmentSize,
	getComposerAttachmentImageSrc,
	getComposerAttachmentTextPreview,
	getComposerAttachmentTypeDescription,
	hasComposerAttachmentVisualPreview,
	watchComposerAttachmentTextScroll,
} from '@studio/agent/protocol/composer-attachment-preview';
import { __, sprintf } from '@wordpress/i18n';
import { useLayoutEffect, useRef } from 'react';
import { AnnotationReviewChip } from '@/features/annotations';
import { FileTextIcon, AnnotateIcon } from '@/lib/icons';
import {
	AttachmentChip as AttachmentChipSurface,
	AttachmentChipTrigger,
	AttachmentRemoveButton,
	Popover,
} from '@/lib/ui';
import styles from './style.module.css';
import type { ComposerAttachment } from '@/data/use-composer-attachments';

function AttachmentTextPreview( { text }: { text: string } ) {
	const viewportRef = useRef< HTMLDivElement | null >( null );
	const textRef = useRef< HTMLPreElement | null >( null );

	useLayoutEffect( () => {
		return watchComposerAttachmentTextScroll( viewportRef.current, textRef.current );
	}, [ text ] );

	return (
		<div className={ styles.attachmentPreviewTextViewport } ref={ viewportRef }>
			<pre className={ styles.attachmentPreviewText } ref={ textRef }>
				{ text }
			</pre>
		</div>
	);
}

function renderAttachmentVisual( attachment: ComposerAttachment ) {
	const imageSrc = getComposerAttachmentImageSrc( attachment );
	if ( imageSrc ) {
		return <img className={ styles.attachmentPreviewImage } src={ imageSrc } alt="" />;
	}
	const textPreview = getComposerAttachmentTextPreview( attachment );
	return textPreview ? <AttachmentTextPreview text={ textPreview } /> : null;
}

function AttachmentChip( {
	attachment,
	isAnnotations,
	onRemove,
}: {
	attachment: ComposerAttachment;
	isAnnotations: boolean;
	onRemove: () => void;
} ) {
	const imageSrc = attachment.kind === 'image' ? getComposerAttachmentImageSrc( attachment ) : null;
	const sizeLabel = formatComposerAttachmentSize( attachment.size );
	const label = sizeLabel
		? sprintf(
				/* translators: 1: attachment file name, 2: attachment size. */
				__( '%1$s, %2$s' ),
				attachment.name,
				sizeLabel
		  )
		: attachment.name;
	const content = (
		<>
			<Popover.Root>
				<Popover.Trigger
					openOnHover
					render={
						<AttachmentChipTrigger
							className={ imageSrc ? styles.imageTrigger : undefined }
							aria-label={ sprintf( __( 'Preview %s' ), attachment.name ) }
						/>
					}
				>
					{ imageSrc ? (
						<img className={ styles.attachmentThumb } src={ imageSrc } alt="" />
					) : (
						<>
							{ isAnnotations ? <AnnotateIcon /> : <FileTextIcon /> }
							<span className={ styles.attachmentName }>{ attachment.name }</span>
						</>
					) }
				</Popover.Trigger>
				<Popover.Popup
					side="top"
					align="start"
					sideOffset={ 8 }
					className={ styles.attachmentPreview }
					aria-label={ attachment.name }
					initialFocus={ ( interactionType ) => interactionType === 'keyboard' }
				>
					{ hasComposerAttachmentVisualPreview( attachment ) && (
						<div className={ styles.attachmentPreviewArtwork }>
							{ renderAttachmentVisual( attachment ) }
						</div>
					) }
					<div className={ styles.attachmentPreviewDetails }>
						<Popover.Title>{ attachment.name }</Popover.Title>
						<Popover.Description>
							{ [ getComposerAttachmentTypeDescription( attachment, __( 'File' ) ), sizeLabel ]
								.filter( Boolean )
								.join( ' · ' ) }
						</Popover.Description>
					</div>
				</Popover.Popup>
			</Popover.Root>
			<AttachmentRemoveButton label={ __( 'Remove attachment' ) } onClick={ onRemove } />
		</>
	);
	return imageSrc ? (
		<li className={ styles.attachment } aria-label={ label }>
			{ content }
		</li>
	) : (
		<AttachmentChipSurface render={ <li /> } aria-label={ label }>
			{ content }
		</AttachmentChipSurface>
	);
}

export function AttachmentChips( {
	attachments,
	annotationsAttachment,
	annotationSiteId,
	onRemove,
}: {
	annotationSiteId?: string;
	attachments: ComposerAttachment[];
	annotationsAttachment: ComposerAttachment | null;
	onRemove: ( attachment: ComposerAttachment ) => void;
} ) {
	return (
		<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
			{ attachments.map( ( attachment ) =>
				attachment === annotationsAttachment && annotationSiteId ? (
					<AnnotationReviewChip
						key={ attachment.id }
						siteId={ annotationSiteId }
						label={ attachment.name }
						description={ sprintf(
							__( '%1$s, %2$s' ),
							attachment.name,
							formatComposerAttachmentSize( attachment.size )
						) }
						onRemove={ () => onRemove( attachment ) }
					/>
				) : (
					<AttachmentChip
						key={ attachment.id }
						attachment={ attachment }
						isAnnotations={ attachment === annotationsAttachment }
						onRemove={ () => onRemove( attachment ) }
					/>
				)
			) }
		</ul>
	);
}
