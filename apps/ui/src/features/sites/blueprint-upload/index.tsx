import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { BlueprintErrorDialog } from '@/features/sites/blueprint-error-dialog';
import { Button } from '@/lib/ui';
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

function hasFiles( event: DragEvent ): boolean {
	return Array.from( event.dataTransfer?.types ?? [] ).includes( 'Files' );
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
	const [ isDragging, setIsDragging ] = useState( false );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const requestRef = useRef( 0 );
	const dragDepthRef = useRef( 0 );

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

	useEffect( () => {
		if ( disabled ) return;
		const handleDragEnter = ( event: DragEvent ) => {
			if ( ! hasFiles( event ) ) return;
			event.preventDefault();
			dragDepthRef.current += 1;
			setIsDragging( true );
		};
		const handleDragOver = ( event: DragEvent ) => {
			if ( ! hasFiles( event ) ) return;
			event.preventDefault();
		};
		const handleDragLeave = () => {
			if ( dragDepthRef.current === 0 ) return;
			dragDepthRef.current = Math.max( 0, dragDepthRef.current - 1 );
			if ( dragDepthRef.current === 0 ) setIsDragging( false );
		};
		const handleDrop = ( event: DragEvent ) => {
			dragDepthRef.current = 0;
			setIsDragging( false );
			if ( ! hasFiles( event ) ) return;
			if ( event.defaultPrevented ) return;
			event.preventDefault();
			const file = event.dataTransfer?.files[ 0 ];
			if ( file ) void handleFile( file );
		};

		window.addEventListener( 'dragenter', handleDragEnter );
		window.addEventListener( 'dragover', handleDragOver );
		window.addEventListener( 'dragleave', handleDragLeave );
		window.addEventListener( 'drop', handleDrop );
		return () => {
			requestRef.current += 1;
			window.removeEventListener( 'dragenter', handleDragEnter );
			window.removeEventListener( 'dragover', handleDragOver );
			window.removeEventListener( 'dragleave', handleDragLeave );
			window.removeEventListener( 'drop', handleDrop );
		};
	}, [ disabled, handleFile ] );

	return (
		<>
			<div className={ variant === 'drop-only' ? styles.control : styles.root }>
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
						<div className={ styles.dropZone }>
							<UploadIcon className={ styles.dropIcon } size={ 24 } />
							<p className={ styles.dropLabel }>{ __( 'Drop a Blueprint here.' ) }</p>
							<Button
								variant="outline"
								disabled={ disabled }
								data-blueprint-upload
								onClick={ () => fileInputRef.current?.click() }
							>
								{ __( 'Choose file' ) }
							</Button>
						</div>
						<p className={ styles.dropHelp }>
							{ __( 'Supports Blueprint JSON files and ZIP bundles.' ) }
						</p>
					</>
				) : variant === 'hint' ? (
					<p className={ styles.prompt }>
						{ createInterpolateElement(
							__( 'Have a blueprint? Drop it anywhere, or <upload>upload a file</upload>.' ),
							{
								upload: (
									<button
										type="button"
										className={ styles.action }
										onClick={ () => fileInputRef.current?.click() }
									/>
								),
							}
						) }
					</p>
				) : null }
				<BlueprintErrorDialog error={ error ?? '' } onDismiss={ handleRemove } />
			</div>
			{ isDragging && (
				<div className={ styles.fullScreenDrop } aria-hidden="true">
					{ __( 'Drop Blueprint to use it for this site' ) }
				</div>
			) }
		</>
	);
}
