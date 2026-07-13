import { __ } from '@wordpress/i18n';
import { upload } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useRef, useState } from 'react';
import styles from './style.module.css';

function formatFileSize( bytes: number ): string {
	if ( bytes === 0 ) return '0 Bytes';
	const k = 1024;
	const sizes = [ 'Bytes', 'KB', 'MB', 'GB' ];
	const i = Math.floor( Math.log( bytes ) / Math.log( k ) );
	return Math.round( ( bytes / Math.pow( k, i ) ) * 100 ) / 100 + ' ' + sizes[ i ];
}

function truncateMiddle( filename: string, maxLength = 30 ): string {
	if ( filename.length <= maxLength ) return filename;
	const ellipsis = '\u2026';
	const charsToShow = maxLength - ellipsis.length;
	const frontChars = Math.ceil( charsToShow / 2 );
	const backChars = Math.floor( charsToShow / 2 );
	return (
		filename.substring( 0, frontChars ) +
		ellipsis +
		filename.substring( filename.length - backChars )
	);
}

interface FileDropzoneProps {
	icon?: Parameters< typeof Icon >[ 0 ][ 'icon' ];
	accept?: string;
	prompt?: string;
	buttonLabel?: string;
	// Parent validates and surfaces any resulting message via `error`.
	onFile: ( file: File ) => void;
	error?: string | null;
	// When set, renders a filled state (filename + Remove). Leave unset for
	// callers that navigate away on successful pick.
	file?: Pick< File, 'name' | 'size' > | null;
	// Required whenever `file` is set.
	onClear?: () => void;
	className?: string;
}

export function FileDropzone( {
	icon = upload,
	accept,
	prompt,
	buttonLabel,
	onFile,
	error,
	file,
	onClear,
	className,
}: FileDropzoneProps ) {
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );

	const openPicker = useCallback( () => fileInputRef.current?.click(), [] );

	const handleFileInputChange = useCallback(
		( event: React.ChangeEvent< HTMLInputElement > ) => {
			const picked = event.target.files?.[ 0 ];
			if ( picked ) onFile( picked );
			// Reset so re-picking the same file after an error re-fires `change`.
			event.target.value = '';
		},
		[ onFile ]
	);

	const handleDrop = useCallback(
		( event: React.DragEvent< HTMLDivElement > ) => {
			event.preventDefault();
			setIsDraggingOver( false );
			const dropped = event.dataTransfer.files[ 0 ];
			if ( dropped ) onFile( dropped );
		},
		[ onFile ]
	);

	const handleDragOver = useCallback( ( event: React.DragEvent< HTMLDivElement > ) => {
		event.preventDefault();
		setIsDraggingOver( true );
	}, [] );

	const handleDragLeave = useCallback( () => setIsDraggingOver( false ), [] );

	return (
		<section className={ className ? `${ styles.root } ${ className }` : styles.root }>
			<div
				className={ `${ styles.dropzone } ${ isDraggingOver ? styles.dropzoneActive : '' }` }
				onDragOver={ handleDragOver }
				onDragLeave={ handleDragLeave }
				onDrop={ handleDrop }
			>
				<Icon icon={ icon } />
				{ file ? (
					<>
						<p className={ styles.fileName } title={ file.name }>
							{ truncateMiddle( file.name ) }
						</p>
						<div className={ styles.fileMeta }>
							<span>{ formatFileSize( file.size ) }</span>
							{ onClear && (
								<Button
									type="button"
									variant="minimal"
									tone="neutral"
									size="small"
									onClick={ onClear }
								>
									{ __( 'Remove' ) }
								</Button>
							) }
						</div>
					</>
				) : (
					<>
						<p className={ styles.prompt }>{ prompt ?? __( 'Drop a file here, or' ) }</p>
						<Button type="button" variant="outline" tone="neutral" onClick={ openPicker }>
							{ buttonLabel ?? __( 'Choose file\u2026' ) }
						</Button>
					</>
				) }
				<input
					ref={ fileInputRef }
					type="file"
					accept={ accept }
					className={ styles.fileInput }
					onChange={ handleFileInputChange }
				/>
			</div>
			{ error && <p className={ styles.error }>{ error }</p> }
		</section>
	);
}
