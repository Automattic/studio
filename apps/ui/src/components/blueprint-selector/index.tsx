import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { __, sprintf } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useState } from 'react';
import { FileDropzone } from '@/components/file-dropzone';
import { useConnector } from '@/data/core';
import styles from './style.module.css';
import type { FeaturedBlueprint } from '@/data/core';
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

interface BlueprintSelectorProps {
	featured: FeaturedBlueprint[] | undefined;
	isFeaturedLoading: boolean;
	onPick: ( blueprint: PickedBlueprint ) => void;
}

const FILE_ACCEPT = 'application/json,.json,application/zip,.zip';

export function BlueprintSelector( {
	featured,
	isFeaturedLoading,
	onPick,
}: BlueprintSelectorProps ) {
	const connector = useConnector();
	const [ uploadError, setUploadError ] = useState< string | null >( null );

	const handleFeaturedClick = useCallback(
		( item: FeaturedBlueprint ) => {
			setUploadError( null );
			onPick( {
				slug: item.slug,
				title: item.title,
				excerpt: item.excerpt,
				blueprint: item.blueprint,
			} );
		},
		[ onPick ]
	);

	const handlePreviewClick = useCallback(
		( event: React.MouseEvent< HTMLButtonElement >, item: FeaturedBlueprint ) => {
			// Stop the click from bubbling to the card's pick handler — the
			// user explicitly asked to preview, not to select.
			event.stopPropagation();
			if ( item.playgroundUrl ) {
				void connector.openExternalUrl( item.playgroundUrl );
			}
		},
		[ connector ]
	);

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

	return (
		<div className={ styles.root }>
			<section className={ styles.section }>
				<h2 className={ styles.sectionTitle }>{ __( 'Upload your own' ) }</h2>
				<FileDropzone
					accept={ FILE_ACCEPT }
					prompt={ __( 'Drop a Blueprint JSON or ZIP bundle here, or' ) }
					onFile={ ( file ) => void handleFile( file ) }
					error={ uploadError }
				/>
			</section>

			<section className={ styles.section }>
				<h2 className={ styles.sectionTitle }>{ __( 'Featured blueprints' ) }</h2>
				{ isFeaturedLoading && (
					<p className={ styles.featuredHint }>{ __( 'Loading featured blueprints…' ) }</p>
				) }
				{ ! isFeaturedLoading && ( ! featured || featured.length === 0 ) && (
					<p className={ styles.featuredHint }>
						{ __( 'No featured blueprints available right now.' ) }
					</p>
				) }
				{ featured && featured.length > 0 && (
					<ul className={ styles.grid }>
						{ featured.map( ( item ) => (
							<li key={ item.slug } className={ styles.cardWrapper }>
								<button
									type="button"
									className={ styles.card }
									onClick={ () => handleFeaturedClick( item ) }
								>
									{ item.image && (
										<img className={ styles.cardImage } src={ item.image } alt="" loading="lazy" />
									) }
									<div className={ styles.cardBody }>
										<h3 className={ styles.cardTitle }>{ item.title }</h3>
										<p className={ styles.cardExcerpt }>{ item.excerpt }</p>
									</div>
								</button>
								{ item.playgroundUrl && (
									<Button
										type="button"
										variant="minimal"
										tone="neutral"
										size="small"
										className={ styles.previewButton }
										onClick={ ( event ) => handlePreviewClick( event, item ) }
										aria-label={ sprintf(
											// translators: %s is the blueprint title.
											__( 'Preview %s in Playground' ),
											item.title
										) }
									>
										<Icon icon={ external } />
										<span>{ __( 'Preview' ) }</span>
									</Button>
								) }
							</li>
						) ) }
					</ul>
				) }
			</section>
		</div>
	);
}
