import { __ } from '@wordpress/i18n';
import { upload } from '@wordpress/icons';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { uploadSiteMedia } from '@/data/wordpress/media';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import {
	getLocalMediaPath,
	getMediaKindForFilename,
	getMediaKindForMimeType,
	getMediaMimeTypeFromFilename,
} from './local-file';
import type { MediaWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function MediaUploadControl( {
	props,
	updateProps,
}: ControlRenderContext< MediaWidgetProps > ) {
	const connector = useConnector();
	const { siteId } = useDesk();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const localPath = getLocalMediaPath( props );
	const [ isUploading, setIsUploading ] = useState( false );

	if ( ! siteId || ! localPath ) {
		return null;
	}

	const isSiteRunning = Boolean( site?.running );
	const canUpload = isSiteRunning && ! isUploading;
	const label = isUploading ? __( 'Uploading media' ) : __( 'Upload to site' );

	return (
		<Button
			icon={ upload }
			label={ label }
			variant="quiet"
			size="medium"
			disabled={ ! canUpload }
			onClick={ async () => {
				if ( ! canUpload ) {
					return;
				}

				setIsUploading( true );
				try {
					const localFile = await connector.readLocalMediaFile( localPath );
					const mimeType =
						props.source?.type === 'local' && props.source.mimeType
							? props.source.mimeType
							: localFile.mimeType || getMediaMimeTypeFromFilename( localFile.name );
					const file = new File( [ localFile.data ], localFile.name, {
						type: mimeType || 'application/octet-stream',
					} );
					const mediaKind =
						getMediaKindForMimeType( mimeType ) ??
						getMediaKindForFilename( localFile.name ) ??
						props.mediaKind;
					const uploadedMedia = await uploadSiteMedia( file );

					updateProps( {
						url: uploadedMedia.source_url,
						mediaKind,
						alt: uploadedMedia.alt_text || props.alt || localFile.name,
						mediaId: uploadedMedia.id,
						source: {
							type: 'site',
						},
					} );
				} catch ( error ) {
					console.warn( 'Failed to upload local media.', error );
				} finally {
					setIsUploading( false );
				}
			} }
		/>
	);
}
