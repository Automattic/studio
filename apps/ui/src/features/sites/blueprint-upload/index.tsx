import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useFileDrop } from '@/data/use-composer-attachments';
import { BlueprintErrorDialog } from '@/features/sites/blueprint-error-dialog';
import { AttachmentDropOverlay, Button } from '@/lib/ui';
import { BLUEPRINT_FILE_ACCEPT, loadBlueprintFile } from './load-blueprint-file';
import styles from './style.module.css';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { ChangeEvent } from 'react';

export type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

interface BlueprintUploadProps {
	variant?: 'hint' | 'panel' | 'drop-only';
	disabled?: boolean;
	onSelect: ( blueprint: SelectedBlueprint ) => void;
	onRemove: () => void;
	onValidityChange: ( isValid: boolean ) => void;
}

export function BlueprintUpload( {
	variant = 'hint',
	disabled = false,
	onSelect,
	onRemove,
	onValidityChange,
}: BlueprintUploadProps ) {
	const connector = useConnector();
	const [ error, setError ] = useState< string | null >( null );
	const [ dropTarget, setDropTarget ] = useState< HTMLDivElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const requestRef = useRef( 0 );

	const handleFile = useCallback(
		async ( file: File ) => {
			if ( disabled ) return;
			const request = ++requestRef.current;
			setError( null );
			onValidityChange( false );
			try {
				const blueprint = await loadBlueprintFile( file, connector );
				if ( request !== requestRef.current ) {
					if ( blueprint.tempDir ) {
						await connector.cleanupBlueprintTempDir( blueprint.tempDir ).catch( () => undefined );
					}
					return;
				}
				onSelect( blueprint );
				onValidityChange( true );
			} catch ( loadError ) {
				if ( request === requestRef.current ) {
					setError(
						loadError instanceof Error
							? loadError.message
							: __( 'Failed to load Blueprint file. Please try again.' )
					);
				}
			}
		},
		[ connector, disabled, onSelect, onValidityChange ]
	);

	const handleInputChange = ( event: ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		if ( file ) void handleFile( file );
		event.target.value = '';
	};
	const handleRemove = () => {
		requestRef.current += 1;
		setError( null );
		if ( fileInputRef.current ) fileInputRef.current.value = '';
		onValidityChange( true );
		onRemove();
	};

	const onFiles = useCallback(
		( files: FileList ) => {
			const file = files[ 0 ];
			if ( file ) void handleFile( file );
		},
		[ handleFile ]
	);
	const isDragging = useFileDrop( disabled ? null : dropTarget, onFiles );
	useEffect(
		() => () => {
			requestRef.current += 1;
		},
		[]
	);

	return (
		<>
			<div
				className={
					variant === 'drop-only'
						? styles.control
						: variant === 'panel'
						? styles.panel
						: styles.root
				}
			>
				<input
					ref={ fileInputRef }
					type="file"
					accept={ BLUEPRINT_FILE_ACCEPT }
					onChange={ handleInputChange }
					className={ styles.fileInput }
					disabled={ disabled }
				/>
				{ variant === 'panel' ? (
					<>
						<div
							ref={ setDropTarget }
							className={ styles.dropZone }
							data-dragging={ isDragging || undefined }
						>
							{ isDragging && (
								<AttachmentDropOverlay>{ __( 'Drop to use Blueprint' ) }</AttachmentDropOverlay>
							) }
							<UploadIcon className={ styles.dropIcon } size={ 24 } />
							<div className={ styles.dropText }>
								<p className={ styles.dropLabel }>{ __( 'Drop a Blueprint here.' ) }</p>
								<p className={ styles.dropHelp }>
									{ __( 'Supports Blueprint JSON files and ZIP bundles.' ) }
								</p>
							</div>
							<Button
								variant="default"
								disabled={ disabled }
								data-blueprint-upload
								onClick={ () => fileInputRef.current?.click() }
							>
								{ __( 'Choose file' ) }
							</Button>
						</div>
					</>
				) : variant === 'hint' ? (
					<p className={ styles.prompt }>
						{ createInterpolateElement( __( 'Have a blueprint? <upload>Upload a file</upload>.' ), {
							upload: (
								<button
									type="button"
									className={ styles.action }
									onClick={ () => fileInputRef.current?.click() }
								/>
							),
						} ) }
					</p>
				) : null }
				<BlueprintErrorDialog error={ error ?? '' } onDismiss={ handleRemove } />
			</div>
		</>
	);
}
