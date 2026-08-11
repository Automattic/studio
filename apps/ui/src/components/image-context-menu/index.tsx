import { __ } from '@wordpress/i18n';
import * as Menu from '@/components/menu';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import type { ReactElement, ReactNode } from 'react';

export interface ContextMenuImage {
	src: string;
	alt: string;
}

/**
 * Filename for saving an image: the alt text when it already looks like an
 * image filename, otherwise the given fallback.
 */
export function getImageFilename( image: ContextMenuImage, fallback = 'image.png' ): string {
	return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test( image.alt ) ? image.alt : fallback;
}

// Re-encode as PNG via canvas — the one format both clipboard backends
// (Electron `nativeImage`, web `ClipboardItem`) reliably accept. Decodes
// from `src` rather than any rendered element so callers always copy the
// full-resolution image, not a thumbnail.
async function toPngDataUrl( src: string ): Promise< string > {
	const image = new Image();
	image.src = src;
	await image.decode();
	const canvas = document.createElement( 'canvas' );
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext( '2d' );
	if ( ! context ) {
		throw new Error( 'Canvas 2D context unavailable' );
	}
	context.drawImage( image, 0, 0 );
	return canvas.toDataURL( 'image/png' );
}

function downloadImage( image: ContextMenuImage, filename: string ) {
	const anchor = document.createElement( 'a' );
	anchor.href = image.src;
	anchor.download = filename;
	anchor.click();
}

/**
 * Right-click menu for a conversation image (thumbnail or lightbox slide).
 * The image element itself is passed as `trigger` and rendered via the
 * context-menu trigger's render prop, so no wrapper DOM is added around it.
 * `children` render above the shared clipboard/save items, separated —
 * callers use them for surface-specific view actions ("Open image",
 * "Actual size").
 */
export function ImageContextMenu( {
	image,
	downloadFilename,
	trigger,
	onOpenChange,
	children,
}: {
	image: ContextMenuImage;
	downloadFilename?: string;
	trigger: ReactElement;
	onOpenChange?: ( open: boolean ) => void;
	children?: ReactNode;
} ) {
	const connector = useConnector();

	const copyImage = async () => {
		try {
			await connector.copyImage( await toPngDataUrl( image.src ) );
			toast.success( __( 'Image copied' ) );
		} catch {
			toast.error( __( 'Failed to copy image' ) );
		}
	};

	const copyAltText = async () => {
		try {
			await connector.copyText( image.alt );
			toast.success( __( 'Alt text copied' ) );
		} catch {
			toast.error( __( 'Failed to copy alt text' ) );
		}
	};

	return (
		<Menu.ContextMenuRoot onOpenChange={ onOpenChange }>
			<Menu.ContextMenuTrigger render={ trigger } />
			<Menu.ContextPopup>
				{ children != null ? (
					<>
						{ children }
						<Menu.Separator />
					</>
				) : null }
				<Menu.Item onClick={ () => void copyImage() }>{ __( 'Copy image' ) }</Menu.Item>
				{ image.alt.trim() ? (
					<Menu.Item onClick={ () => void copyAltText() }>{ __( 'Copy alt text' ) }</Menu.Item>
				) : null }
				<Menu.Item
					onClick={ () => downloadImage( image, downloadFilename ?? getImageFilename( image ) ) }
				>
					{ __( 'Save image…' ) }
				</Menu.Item>
			</Menu.ContextPopup>
		</Menu.ContextMenuRoot>
	);
}
