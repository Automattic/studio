import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { Button, DropZone } from '@/lib/ui';
import styles from './style.module.css';

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
				accept={ [ '.json', ...ACCEPTED_ADD_SITE_FILE_TYPES ].join( ',' ) }
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
				description={ __(
					'Supports Blueprint JSON and ZIP files, backups from WordPress.com, Jetpack, Local, Playground, and All-in-One WP Migration, plus WordPress XML exports.'
				) }
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
			</DropZone>
		</div>
	);
}
