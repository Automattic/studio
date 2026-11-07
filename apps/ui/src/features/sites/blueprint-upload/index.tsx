import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import { __, sprintf } from '@wordpress/i18n';
import { useRef } from 'react';
import { Button, DropZone } from '@/lib/ui';
import styles from './style.module.css';

export const SITE_FILE_UPLOAD_TYPES = [ '.json', ...ACCEPTED_ADD_SITE_FILE_TYPES ];

interface SiteFileUploadProps {
	disabled?: boolean;
	onFile: ( file: File ) => void;
}

export function SiteFileUpload( { disabled = false, onFile }: SiteFileUploadProps ) {
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	return (
		<div className={ styles.panel }>
			<input
				ref={ fileInputRef }
				type="file"
				accept={ SITE_FILE_UPLOAD_TYPES.join( ',' ) }
				onChange={ ( event ) => {
					const file = event.target.files?.[ 0 ];
					if ( file ) void onFile( file );
					event.target.value = '';
				} }
				className={ styles.fileInput }
				disabled={ disabled }
			/>
			<DropZone
				className={ styles.zone }
				title={ __( 'Drop your file here' ) }
				description={ __( 'Blueprints, backups, and WordPress exports' ) }
			>
				<Button
					className={ styles.choose }
					variant="outline"
					disabled={ disabled }
					data-site-file-upload
					onClick={ () => fileInputRef.current?.click() }
				>
					{ __( 'Choose file' ) }
				</Button>
				<p className={ styles.fileTypes }>
					{ sprintf(
						// translators: %s is a comma-separated list of supported file extensions.
						__( 'Supported files: %s.' ),
						SITE_FILE_UPLOAD_TYPES.join( ', ' )
					) }
				</p>
			</DropZone>
		</div>
	);
}
