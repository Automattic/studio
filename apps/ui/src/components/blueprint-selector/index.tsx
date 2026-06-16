import { EMPTY_SITE_PLAYGROUND_URL } from '@studio/common/constants';
import {
	curateBlueprintsForDisplay,
	FEATURED_BLUEPRINT_SLUGS,
} from '@studio/common/lib/blueprint-curation';
import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { seen } from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useGridArrowNavigation } from '@/hooks/use-grid-arrow-navigation';
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
	blueprints: FeaturedBlueprint[] | undefined;
	isLoading: boolean;
	onPick: ( blueprint: PickedBlueprint ) => void;
	// Picking the "Empty site" card — callers route this to the plain
	// create-site flow rather than running an empty blueprint.
	onPickEmpty: () => void;
}

const FILE_ACCEPT = 'application/json,.json,application/zip,.zip';

/**
 * Preview (eye) button overlaid on a card's image. Rendered as a sibling of
 * the card's pick button (inside `cardMediaOverlay`) rather than nested in
 * it, so the markup stays valid — nested interactive elements aren't.
 */
function PreviewOverlay( { url, title }: { url: string; title: string } ) {
	const connector = useConnector();
	const label = __( 'Preview in your browser' );
	return (
		<div className={ styles.cardMediaOverlay }>
			<Tooltip.Provider delay={ 200 }>
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<button
								type="button"
								className={ styles.previewButton }
								onClick={ () => void connector.openExternalUrl( url ) }
								aria-label={ sprintf(
									// translators: %s is the blueprint title.
									__( 'Preview %s in Playground' ),
									title
								) }
							>
								<Icon icon={ seen } size={ 16 } />
							</button>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ label }
					</Tooltip.Popup>
				</Tooltip.Root>
			</Tooltip.Provider>
		</div>
	);
}

function EmptySiteCard( { onPick }: { onPick: () => void } ) {
	return (
		<li className={ styles.cardWrapper }>
			<button type="button" className={ styles.card } onClick={ onPick } data-arrow-nav-item>
				<span className={ styles.emptyMedia }>
					<span className={ styles.emptyMediaGrid } />
					{ /* Centered document glyph */ }
					<svg
						width="44"
						height="56"
						viewBox="0 0 44 56"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						aria-hidden="true"
						data-keep-size
					>
						<path
							d="M 4 4 L 28 4 L 40 16 L 40 52 L 4 52 Z"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinejoin="round"
							fill="none"
						/>
						<path
							d="M 28 4 L 28 16 L 40 16"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinejoin="round"
							fill="none"
						/>
					</svg>
				</span>
				<span className={ styles.cardBody }>
					<h3 className={ styles.cardTitle }>{ __( 'Empty site' ) }</h3>
					<p className={ styles.cardExcerpt }>
						{ __( 'A clean WordPress install. Build whatever you want from scratch.' ) }
					</p>
				</span>
			</button>
			<PreviewOverlay url={ EMPTY_SITE_PLAYGROUND_URL } title={ __( 'Empty site' ) } />
		</li>
	);
}

function BlueprintCard( {
	blueprint,
	onPick,
}: {
	blueprint: FeaturedBlueprint;
	onPick: ( blueprint: FeaturedBlueprint ) => void;
} ) {
	return (
		<li className={ styles.cardWrapper }>
			<button
				type="button"
				className={ styles.card }
				onClick={ () => onPick( blueprint ) }
				data-arrow-nav-item
			>
				{ blueprint.image ? (
					<img className={ styles.cardImage } src={ blueprint.image } alt="" loading="lazy" />
				) : (
					<span className={ styles.cardImageFallback }>{ blueprint.title }</span>
				) }
				<span className={ styles.cardBody }>
					<h3 className={ styles.cardTitle }>{ blueprint.title }</h3>
					<p className={ styles.cardExcerpt } title={ blueprint.excerpt }>
						{ blueprint.excerpt }
					</p>
				</span>
			</button>
			{ blueprint.playgroundUrl && (
				<PreviewOverlay url={ blueprint.playgroundUrl } title={ blueprint.title } />
			) }
		</li>
	);
}

export function BlueprintSelector( {
	blueprints,
	isLoading,
	onPick,
	onPickEmpty,
}: BlueprintSelectorProps ) {
	const connector = useConnector();
	const uploadInputRef = useRef< HTMLInputElement | null >( null );
	const handleGridKeyDown = useGridArrowNavigation();
	const [ uploadError, setUploadError ] = useState< string | null >( null );

	// The endpoint returns blueprints oldest-first; newest-first reads better
	// in the Explore grid (matches the desktop renderer).
	const allBlueprints = useMemo( () => ( blueprints ?? [] ).slice().reverse(), [ blueprints ] );

	const featuredBlueprints = useMemo(
		() =>
			curateBlueprintsForDisplay(
				allBlueprints.filter( ( blueprint ) => FEATURED_BLUEPRINT_SLUGS.has( blueprint.slug ) ),
				__
			),
		[ allBlueprints ]
	);
	const exploreBlueprints = useMemo(
		() => allBlueprints.filter( ( blueprint ) => ! FEATURED_BLUEPRINT_SLUGS.has( blueprint.slug ) ),
		[ allBlueprints ]
	);

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

	// Callers advertise "drop in your own", so the whole selector accepts
	// blueprint drops; any validation error renders next to the Upload
	// button above the explore grid.
	const handleRootDrop = useCallback(
		( event: React.DragEvent< HTMLDivElement > ) => {
			if ( event.defaultPrevented ) {
				return;
			}
			event.preventDefault();
			const file = event.dataTransfer.files[ 0 ];
			if ( ! file ) {
				return;
			}
			void handleFile( file );
		},
		[ handleFile ]
	);

	return (
		<div
			className={ styles.root }
			onDragOver={ ( event ) => event.preventDefault() }
			onDrop={ handleRootDrop }
		>
			<section className={ styles.section }>
				<ul
					className={ `${ styles.grid } ${ styles.gridFeatured }` }
					onKeyDown={ handleGridKeyDown }
				>
					<EmptySiteCard onPick={ onPickEmpty } />
					{ isLoading && (
						<li className={ styles.gridStatus }>
							<Spinner />
						</li>
					) }
					{ ! isLoading && allBlueprints.length === 0 && (
						<li className={ styles.gridStatus }>{ __( 'Could not load templates.' ) }</li>
					) }
					{ featuredBlueprints.map( ( item ) => (
						<BlueprintCard key={ item.slug } blueprint={ item } onPick={ handleFeaturedClick } />
					) ) }
				</ul>
			</section>

			<section className={ `${ styles.section } ${ styles.exploreSection }` }>
				<header className={ styles.exploreHeader }>
					<h2 className={ styles.sectionTitle }>{ __( 'More blueprints' ) }</h2>
					<p className={ styles.exploreSubtitle }>
						{ __( 'Get started quickly with a one of our blueprints, or' ) }{ ' ' }
						<Button
							type="button"
							variant="minimal"
							tone="brand"
							className={ styles.uploadLink }
							onClick={ () => uploadInputRef.current?.click() }
						>
							{ __( 'upload a blueprint' ) }
						</Button>
						{ '.' }
					</p>
				</header>
				{ uploadError && (
					<p role="alert" className={ styles.uploadError }>
						{ uploadError }
					</p>
				) }
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
				{ exploreBlueprints.length > 0 && (
					<ul
						className={ `${ styles.grid } ${ styles.gridCompact }` }
						onKeyDown={ handleGridKeyDown }
					>
						{ exploreBlueprints.map( ( item ) => (
							<BlueprintCard key={ item.slug } blueprint={ item } onPick={ handleFeaturedClick } />
						) ) }
					</ul>
				) }
			</section>
		</div>
	);
}
