import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { createSelectedBlueprint } from '@/lib/blueprint-selection';
import styles from './style.module.css';
import type { Connector } from '@/data/core';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';
import type { ChangeEvent } from 'react';

export type { SelectedBlueprint } from '@/lib/blueprint-selection';

interface BlueprintUploadProps {
	selected: SelectedBlueprint | null;
	onSelect: ( blueprint: SelectedBlueprint ) => void;
	onRemove: () => void;
	onValidityChange: ( isValid: boolean ) => void;
}

const FILE_ACCEPT = 'application/json,.json,application/zip,.zip';

async function loadBlueprintFile( file: File, connector: Connector ): Promise< SelectedBlueprint > {
	const lowerName = file.name.toLowerCase();
	const isJson = file.type === 'application/json' || lowerName.endsWith( '.json' );
	const isZip = file.type === 'application/zip' || lowerName.endsWith( '.zip' );

	if ( isJson ) {
		let parsed: unknown;
		try {
			parsed = JSON.parse( await file.text() );
		} catch {
			throw new Error(
				__(
					'This Blueprint JSON file could not be read. Check that it contains valid JSON and try again.'
				)
			);
		}
		return createSelectedBlueprint( parsed, file );
	}

	if ( ! isZip ) {
		throw new Error(
			__( 'That file type is not supported. Choose a Blueprint JSON file or ZIP bundle.' )
		);
	}

	const extracted = await connector.extractBlueprintBundle( file ).catch( () => {
		throw new Error(
			__(
				'This ZIP could not be used. Make sure it contains a valid blueprint.json file at the top level and try again.'
			)
		);
	} );
	try {
		return await createSelectedBlueprint( extracted.blueprintJson, file, {
			filePath: extracted.blueprintJsonPath,
			tempDir: extracted.tempDir,
		} );
	} catch ( error ) {
		await connector.cleanupBlueprintTempDir( extracted.tempDir ).catch( () => undefined );
		throw error;
	}
}

function hasFiles( event: DragEvent ): boolean {
	return Array.from( event.dataTransfer?.types ?? [] ).includes( 'Files' );
}

export function BlueprintUpload( {
	selected,
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
		[ connector, onSelect, onValidityChange ]
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
	}, [ handleFile ] );

	return (
		<>
			<div className={ styles.root }>
				<input
					ref={ fileInputRef }
					type="file"
					accept={ FILE_ACCEPT }
					onChange={ handleInputChange }
					className={ styles.fileInput }
				/>
				<p className={ styles.prompt }>
					{ selected
						? createInterpolateElement(
								__(
									'Using <filename></filename>. <replace>Replace</replace> or <remove>remove</remove>.'
								),
								{
									filename: <span title={ selected.file.name }>{ selected.file.name }</span>,
									replace: (
										<button
											type="button"
											className={ styles.action }
											onClick={ () => fileInputRef.current?.click() }
										/>
									),
									remove: (
										<button type="button" className={ styles.action } onClick={ handleRemove } />
									),
								}
						  )
						: createInterpolateElement(
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
				{ error && (
					<p role="alert" className={ styles.error }>
						<span>
							{ sprintf(
								// translators: %s is the Blueprint validation or upload error.
								__( 'Blueprint error: %s' ),
								error
							) }
						</span>
						{ ! selected && (
							<button type="button" className={ styles.action } onClick={ handleRemove }>
								{ __( 'Remove' ) }
							</button>
						) }
					</p>
				) }
			</div>
			{ isDragging && (
				<div className={ styles.fullScreenDrop } aria-hidden="true">
					{ __( 'Drop Blueprint to use it for this site' ) }
				</div>
			) }
		</>
	);
}
