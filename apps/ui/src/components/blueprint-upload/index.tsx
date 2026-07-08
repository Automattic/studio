/**
 * Bring-your-own-blueprint affordance for the create-site screen: a quiet
 * hint line with an upload link, plus window-wide drag-and-drop so a
 * blueprint JSON or ZIP bundle can be dropped anywhere on the page. Parsing
 * and validation match the desktop renderer's Add Site flow.
 */

import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './style.module.css';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface PickedBlueprint {
	title: string;
	excerpt: string;
	// `slug` is only populated for featured blueprints (used for stats server-side).
	slug?: string;
	blueprint: BlueprintV1Declaration;
	// Absolute path to the extracted `blueprint.json` when the user uploaded a
	// ZIP bundle — the CLI uses this to resolve relative asset references.
	// Main process cleans up the enclosing temp dir once site creation runs.
	filePath?: string;
}

const FILE_ACCEPT = 'application/json,.json,application/zip,.zip';

export function BlueprintUploadHint( {
	onPick,
}: {
	onPick: ( blueprint: PickedBlueprint ) => void;
} ) {
	const connector = useConnector();
	const uploadInputRef = useRef< HTMLInputElement | null >( null );
	const [ uploadError, setUploadError ] = useState< string | null >( null );

	/**
	 * Validates parsed blueprint JSON and hands a `PickedBlueprint` to the
	 * parent. Returns `true` on success so callers can tell whether to clean
	 * up side-resources (extracted ZIP temp dirs, etc.).
	 */
	const acceptParsedBlueprint = useCallback(
		async ( parsed: unknown, fileName: string, filePath?: string ): Promise< boolean > => {
			// v2 blueprints need a different runner — block them up-front with a
			// clear message rather than letting validation spit out a cryptic
			// schema error. Matches the behavior of the desktop app.
			if (
				parsed &&
				typeof parsed === 'object' &&
				( parsed as { version?: number } ).version === 2
			) {
				setUploadError(
					__( 'Blueprint v2 format is not supported yet. Please use Blueprint v1 format.' )
				);
				return false;
			}
			const validation = await validateBlueprintData( parsed );
			if ( ! validation.valid ) {
				setUploadError( validation.error );
				return false;
			}
			const blueprint = parsed as BlueprintV1Declaration;
			const meta = ( parsed as { meta?: { title?: string; description?: string } } ).meta;
			const baseName = fileName.replace( /\.(json|zip)$/i, '' );
			onPick( {
				title: meta?.title || baseName,
				excerpt: meta?.description || generateDefaultBlueprintDescription( blueprint ),
				blueprint,
				filePath,
			} );
			return true;
		},
		[ onPick ]
	);

	const handleFile = useCallback(
		async ( file: File ) => {
			setUploadError( null );
			const lowerName = file.name.toLowerCase();
			const isJson = file.type === 'application/json' || lowerName.endsWith( '.json' );
			const isZip = file.type === 'application/zip' || lowerName.endsWith( '.zip' );

			if ( isJson ) {
				let parsed: unknown;
				try {
					parsed = JSON.parse( await file.text() );
				} catch ( error ) {
					setUploadError(
						sprintf(
							// translators: %s is the JSON parser error message.
							__( 'Could not parse Blueprint JSON: %s' ),
							error instanceof Error ? error.message : String( error )
						)
					);
					return;
				}
				await acceptParsedBlueprint( parsed, file.name );
				return;
			}

			if ( isZip ) {
				// ZIP bundles have to be unpacked in the main process so the CLI
				// can resolve relative asset references — we ship the extracted
				// `blueprint.json` path along with the parsed JSON. Temp dir
				// cleanup happens server-side once `createSite` runs; only the
				// validation-failure branch here needs an explicit cleanup.
				let tempDir: string | undefined;
				try {
					const zipPath = await connector.getFilePath( file );
					if ( ! zipPath ) {
						setUploadError(
							__( 'Unable to resolve the ZIP file path. Try choosing the file via the button.' )
						);
						return;
					}
					const extracted = await connector.extractBlueprintBundle( zipPath );
					tempDir = extracted.tempDir;
					const ok = await acceptParsedBlueprint(
						extracted.blueprintJson,
						file.name,
						extracted.blueprintJsonPath
					);
					if ( ! ok && tempDir ) {
						void connector.cleanupBlueprintTempDir( tempDir );
					}
				} catch ( error ) {
					if ( tempDir ) {
						void connector.cleanupBlueprintTempDir( tempDir );
					}
					setUploadError(
						error instanceof Error
							? error.message
							: __( 'Failed to load Blueprint ZIP file. Please try again.' )
					);
				}
				return;
			}

			setUploadError( __( 'Please select a Blueprint JSON or ZIP bundle.' ) );
		},
		[ acceptParsedBlueprint, connector ]
	);

	// "Drop it anywhere" means the whole window, not just this hint — the
	// create screen has no competing drop targets.
	useEffect( () => {
		const onDragOver = ( event: DragEvent ) => {
			event.preventDefault();
		};
		const onDrop = ( event: DragEvent ) => {
			if ( event.defaultPrevented ) {
				return;
			}
			event.preventDefault();
			const file = event.dataTransfer?.files[ 0 ];
			if ( file ) {
				void handleFile( file );
			}
		};
		window.addEventListener( 'dragover', onDragOver );
		window.addEventListener( 'drop', onDrop );
		return () => {
			window.removeEventListener( 'dragover', onDragOver );
			window.removeEventListener( 'drop', onDrop );
		};
	}, [ handleFile ] );

	return (
		<div className={ styles.uploadFooter }>
			{ uploadError && (
				<p role="alert" className={ styles.uploadError }>
					{ uploadError }
				</p>
			) }
			<p className={ styles.uploadHint }>
				{ __( 'Have a blueprint? Drop it anywhere, or' ) }{ ' ' }
				<Button
					type="button"
					variant="minimal"
					tone="brand"
					className={ styles.uploadLink }
					onClick={ () => uploadInputRef.current?.click() }
				>
					{ __( 'upload a file' ) }
				</Button>
				{ '.' }
			</p>
			<input
				ref={ uploadInputRef }
				type="file"
				accept={ FILE_ACCEPT }
				className={ styles.hiddenInput }
				onChange={ ( event ) => {
					const file = event.target.files?.[ 0 ];
					if ( file ) {
						void handleFile( file );
					}
					// Reset so re-picking the same file after an error re-fires
					// `change`.
					event.target.value = '';
				} }
			/>
		</div>
	);
}
