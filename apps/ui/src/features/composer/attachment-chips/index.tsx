import {
	formatComposerAttachmentSize,
	getComposerAttachmentImageSrc,
	getComposerAttachmentTextPreview,
	getComposerAttachmentTypeDescription,
	hasComposerAttachmentVisualPreview,
	watchComposerAttachmentTextScroll,
} from '@studio/agent/protocol/composer-attachment-preview';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { FileTextIcon, XIcon } from 'lucide-react';
import { cloneElement, useLayoutEffect, useRef } from 'react';
import { AnnotateIcon } from '@/lib/icons';
import { AttachmentChip as AttachmentChipSurface, Button, HoverCard } from '@/lib/ui';
import styles from './style.module.css';
import type { ComposerAttachment } from '@/data/use-composer-attachments';

function AttachmentHoverTextPreview( { text }: { text: string } ) {
	const viewportRef = useRef< HTMLDivElement | null >( null );
	const textRef = useRef< HTMLPreElement | null >( null );

	useLayoutEffect( () => {
		return watchComposerAttachmentTextScroll( viewportRef.current, textRef.current );
	}, [ text ] );

	return (
		<div className={ styles.attachmentHoverTextViewport } aria-hidden="true" ref={ viewportRef }>
			<pre className={ styles.attachmentHoverText } ref={ textRef }>
				{ text }
			</pre>
		</div>
	);
}

function renderAttachmentHoverVisual( attachment: ComposerAttachment ) {
	const imageSrc = getComposerAttachmentImageSrc( attachment );
	if ( imageSrc ) {
		return <img className={ styles.attachmentHoverImage } src={ imageSrc } alt="" />;
	}
	const textPreview = getComposerAttachmentTextPreview( attachment );
	return textPreview ? <AttachmentHoverTextPreview text={ textPreview } /> : null;
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
	const chip = imageSrc ? (
		<li className={ clsx( styles.attachment, styles.attachmentImage ) } aria-label={ label } />
	) : (
		<AttachmentChipSurface render={ <li /> } aria-label={ label } />
	);
	const content = (
		<>
			{ imageSrc ? (
				<img className={ styles.attachmentThumb } src={ imageSrc } alt="" />
			) : (
				<>
					{ isAnnotations ? <AnnotateIcon /> : <FileTextIcon /> }
					<span className={ styles.attachmentName }>{ attachment.name }</span>
				</>
			) }
			<Button
				variant="outline"
				size="icon-2xs"
				shape="round"
				className={ styles.attachmentRemove }
				aria-label={ __( 'Remove attachment' ) }
				onClick={ onRemove }
			>
				<XIcon />
			</Button>
		</>
	);
	if ( ! hasComposerAttachmentVisualPreview( attachment ) ) {
		return cloneElement( chip, {}, content );
	}
	return (
		<HoverCard.Root>
			<HoverCard.Trigger render={ chip }>{ content }</HoverCard.Trigger>
			<HoverCard.Popup
				side="top"
				align="start"
				sideOffset={ 8 }
				className={ styles.attachmentHoverPreview }
			>
				<div className={ styles.attachmentHoverArtwork }>
					{ renderAttachmentHoverVisual( attachment ) }
				</div>
				<div className={ styles.attachmentHoverDetails }>
					<span className={ styles.attachmentHoverName }>{ attachment.name }</span>
					<span className={ styles.attachmentHoverMeta }>
						{ [ getComposerAttachmentTypeDescription( attachment, __( 'File' ) ), sizeLabel ]
							.filter( Boolean )
							.join( ' · ' ) }
					</span>
				</div>
			</HoverCard.Popup>
		</HoverCard.Root>
	);
}

export function AttachmentChips( {
	attachments,
	annotationsAttachment,
	onRemove,
}: {
	attachments: ComposerAttachment[];
	annotationsAttachment: ComposerAttachment | null;
	onRemove: ( attachment: ComposerAttachment ) => void;
} ) {
	return (
		<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
			{ attachments.map( ( attachment ) => (
				<AttachmentChip
					key={ attachment.id }
					attachment={ attachment }
					isAnnotations={ attachment === annotationsAttachment }
					onRemove={ () => onRemove( attachment ) }
				/>
			) ) }
		</ul>
	);
}
