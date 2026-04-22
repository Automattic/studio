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
	/**
	 * Icon shown in both empty and filled states. Defaults to `upload`.
	 */
	icon?: Parameters< typeof Icon >[ 0 ][ 'icon' ];
	/**
	 * `accept` attribute forwarded to the underlying `<input type="file">`.
	 * Accept only narrows the native file picker — callers should still
	 * validate picked files before acting on them.
	 */
	accept?: string;
	/**
	 * Empty-state prompt shown above the "Choose file…" button. Defaults to a
	 * generic "Drop a file here, or".
	 */
	prompt?: string;
	/**
	 * Empty-state button label. Defaults to "Choose file…".
	 */
	buttonLabel?: string;
	/**
	 * Fires whenever the user picks or drops a file. The parent is responsible
	 * for validating the file (type, contents) and surfacing any resulting
	 * error via the `error` prop — the dropzone itself is unopinionated.
	 */
	onFile: ( file: File ) => void;
	/**
	 * Inline error message shown directly below the dropzone. Controlled by
	 * the parent so validation rules can live where the domain logic is.
	 */
	error?: string | null;
	/**
	 * When set, swaps the empty state for a filled state that shows the
	 * filename, size, and a Remove button. Leave `null`/`undefined` for flows
	 * that navigate away as soon as a file is accepted.
	 */
	file?: File | null;
	/**
	 * Fires when the user clicks the Remove button in the filled state.
	 * Required whenever `file` is set.
	 */
	onClear?: () => void;
	/**
	 * Forwarded for callers that want to attach their own accessible label or
	 * test id to the outer section.
	 */
	className?: string;
}

/**
 * Low-level drag-and-drop file picker. Owns the drag events, the hidden
 * `<input type="file">`, the visual empty/filled states, and the CSS. Parents
 * handle validation + side effects by consuming `onFile` and passing an
 * `error` string back in when validation fails.
 *
 * The filled state (`file` prop) is opt-in — flows that immediately navigate
 * away after a successful pick (e.g. the blueprint selector) can skip it and
 * let the empty state stay put.
 */
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
