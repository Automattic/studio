import { __ } from '@wordpress/i18n';
import workbenchStyles from '../development-workbench.module.css';
import { formatFileSize } from './utils';

type ImageFilePreviewProps = {
	path: string;
	dataUrl?: string;
	mediaType?: string;
	size?: number;
};

export function ImageFilePreview( { path, dataUrl, mediaType, size }: ImageFilePreviewProps ) {
	const fileName = path.split( '/' ).pop() || path;

	return (
		<div className={ workbenchStyles.imagePreviewShell }>
			<div className={ workbenchStyles.imagePreviewCanvas }>
				{ dataUrl ? (
					<img src={ dataUrl } alt={ fileName } />
				) : (
					<div className={ workbenchStyles.imagePreviewEmpty }>
						<strong>{ __( 'Preview unavailable' ) }</strong>
						<span>{ __( 'Studio could not render this image file.' ) }</span>
					</div>
				) }
			</div>
			<div className={ workbenchStyles.imagePreviewMeta }>
				<strong>{ fileName }</strong>
				<span>
					{ [ mediaType, typeof size === 'number' ? formatFileSize( size ) : undefined ]
						.filter( Boolean )
						.join( ' - ' ) }
				</span>
			</div>
		</div>
	);
}
