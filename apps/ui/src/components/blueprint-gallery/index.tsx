import { __ } from '@wordpress/i18n';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useBlueprints } from '@/data/queries/use-blueprints';
import { useOffline } from '@/hooks/use-offline';
import { BLUEPRINT_FILE_ACCEPT, loadBlueprintFile } from '@/lib/load-blueprint-file';
import styles from './style.module.css';
import { UploadTile } from './upload-tile';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

const FEATURED_BLUEPRINT_SLUGS = new Set( [ 'woo-shop', 'development', 'quick-start' ] );

const BLUEPRINT_DISPLAY_NAMES: Record< string, string > = {
	'Quick Start': 'WordPress.com',
	Development: 'WordPress Dev',
	Commerce: 'WooCommerce',
};

function getBlueprintExcerptOverrides(): Record< string, string > {
	return {
		'Quick Start': __(
			'A WordPress.com-like environment with Business plan plugins and themes pre-installed.'
		),
		Commerce: __(
			'Create your next online store with WooCommerce and its companion plugins pre-installed.'
		),
		Development: __( 'A streamlined environment for building and testing themes or plugins.' ),
	};
}

const BLUEPRINT_ORDER: Record< string, number > = {
	'Quick Start': 1,
	Commerce: 2,
	Development: 3,
};

function renameBlueprintsForDisplay( blueprints: Blueprint[] ): Blueprint[] {
	const excerptOverrides = getBlueprintExcerptOverrides();
	return [ ...blueprints ]
		.sort( ( a, b ) => ( BLUEPRINT_ORDER[ a.title ] ?? 99 ) - ( BLUEPRINT_ORDER[ b.title ] ?? 99 ) )
		.map( ( item ) => ( {
			...item,
			excerpt: excerptOverrides[ item.title ] || item.excerpt,
			title: BLUEPRINT_DISPLAY_NAMES[ item.title ] || item.title,
		} ) );
}

function apiToSelectedBlueprint( bp: Blueprint ): SelectedBlueprint {
	return {
		title: bp.title,
		excerpt: bp.excerpt,
		blueprint: bp.blueprint as BlueprintV1Declaration,
		file: { name: bp.title, size: 0 },
		filePath: bp.filePath,
		bundleUrl: bp.bundle_url ?? undefined,
	};
}

function BlueprintCard( { blueprint, onClick }: { blueprint: Blueprint; onClick: () => void } ) {
	return (
		<button type="button" className={ styles.card } onClick={ onClick }>
			{ blueprint.image ? (
				<img src={ blueprint.image } alt="" className={ styles.cardImage } loading="lazy" />
			) : (
				<div className={ styles.cardImageFallback }>{ blueprint.title }</div>
			) }
			<div className={ styles.cardBody }>
				<h3 className={ styles.cardTitle }>{ blueprint.title }</h3>
				<p className={ styles.cardExcerpt }>{ blueprint.excerpt }</p>
			</div>
		</button>
	);
}

// Sits alongside the curated Blueprints so "bring your own" is one of the
// choices rather than a separate step. Drag handling is scoped to this card,
// not the window, so it can't intercept a backup dropped on the Import card.
function UploadBlueprintCard( { onSelect }: { onSelect: ( bp: SelectedBlueprint ) => void } ) {
	const connector = useConnector();
	const inputRef = useRef< HTMLInputElement >( null );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ isReading, setIsReading ] = useState( false );
	const [ error, setError ] = useState( '' );

	const handleFile = useCallback(
		async ( file?: File ) => {
			if ( ! file ) return;
			setError( '' );
			setIsReading( true );
			try {
				onSelect( await loadBlueprintFile( file, connector ) );
			} catch ( loadError ) {
				setError(
					loadError instanceof Error
						? loadError.message
						: __( 'Failed to load Blueprint file. Please try again.' )
				);
			} finally {
				setIsReading( false );
			}
		},
		[ connector, onSelect ]
	);

	return (
		<>
			<input
				ref={ inputRef }
				type="file"
				accept={ BLUEPRINT_FILE_ACCEPT }
				className={ styles.hiddenInput }
				onChange={ ( event ) => {
					void handleFile( event.target.files?.[ 0 ] );
					event.target.value = '';
				} }
			/>
			<button
				type="button"
				className={ `${ styles.card } ${ isDragging ? styles.uploadCardDragging : '' }` }
				onClick={ () => inputRef.current?.click() }
				onDragOver={ ( event ) => {
					event.preventDefault();
					setIsDragging( true );
					setError( '' );
				} }
				onDragLeave={ ( event ) => {
					event.preventDefault();
					if ( event.currentTarget.contains( event.relatedTarget as Node | null ) ) return;
					setIsDragging( false );
				} }
				onDrop={ ( event ) => {
					event.preventDefault();
					setIsDragging( false );
					void handleFile( event.dataTransfer.files[ 0 ] );
				} }
			>
				<UploadTile />
				<div className={ styles.cardBody }>
					<h3 className={ styles.cardTitle }>{ __( 'Upload a Blueprint' ) }</h3>
					<p className={ styles.cardExcerpt }>
						{ isReading
							? __( 'Reading Blueprint…' )
							: __( 'Use your own Blueprint JSON file or ZIP bundle.' ) }
					</p>
					{ error && (
						<span role="alert" className={ styles.uploadError }>
							{ error }
						</span>
					) }
				</div>
			</button>
		</>
	);
}

interface BlueprintGalleryProps {
	onSelect: ( blueprint: SelectedBlueprint ) => void;
}

export function BlueprintGallery( { onSelect }: BlueprintGalleryProps ) {
	const isOffline = useOffline();
	const { data: blueprints, isLoading, isError } = useBlueprints();
	const [ searchQuery, setSearchQuery ] = useState( '' );

	const featured = useMemo(
		() =>
			renameBlueprintsForDisplay(
				( blueprints ?? [] ).filter( ( bp ) => FEATURED_BLUEPRINT_SLUGS.has( bp.slug ) )
			),
		[ blueprints ]
	);

	const explore = useMemo(
		() => ( blueprints ?? [] ).filter( ( bp ) => ! FEATURED_BLUEPRINT_SLUGS.has( bp.slug ) ),
		[ blueprints ]
	);

	const filteredExplore = useMemo( () => {
		const query = searchQuery.toLowerCase().trim();
		if ( ! query ) {
			return explore;
		}
		return explore.filter( ( bp ) => {
			const titleMatch = bp.title.toLowerCase().includes( query );
			const excerptMatch = bp.excerpt.toLowerCase().includes( query );
			const meta = ( bp.blueprint as Record< string, unknown > )?.meta as
				| Record< string, unknown >
				| undefined;
			const categoryList = ( meta?.categories ?? [] ) as string[];
			const categoryMatch = categoryList.some( ( cat ) => cat.toLowerCase().includes( query ) );
			return titleMatch || excerptMatch || categoryMatch;
		} );
	}, [ explore, searchQuery ] );

	const renderCard = ( bp: Blueprint ) => (
		<BlueprintCard
			key={ bp.slug }
			blueprint={ bp }
			onClick={ () => onSelect( apiToSelectedBlueprint( bp ) ) }
		/>
	);

	return (
		<section className={ styles.root } aria-labelledby="blueprint-gallery-heading">
			<h2 id="blueprint-gallery-heading" className={ styles.heading }>
				{ __( 'Or start from a Blueprint' ) }
			</h2>

			{ isLoading ? (
				<p className={ styles.notice }>{ __( 'Loading Blueprints…' ) }</p>
			) : isError || isOffline ? (
				<p className={ styles.notice }>
					{ __( 'Blueprints could not be loaded. Check your internet connection and try again.' ) }
				</p>
			) : (
				<>
					<div className={ styles.grid }>
						{ featured.map( renderCard ) }
						<UploadBlueprintCard onSelect={ onSelect } />
					</div>

					{ explore.length > 0 && (
						<>
							<div className={ styles.exploreHeader }>
								<h3 className={ styles.exploreTitle }>{ __( 'Explore more Blueprints' ) }</h3>
								<input
									type="search"
									className={ styles.searchInput }
									placeholder={ __( 'Search Blueprints' ) }
									aria-label={ __( 'Search Blueprints' ) }
									value={ searchQuery }
									onChange={ ( event ) => setSearchQuery( event.target.value ) }
								/>
							</div>
							{ filteredExplore.length === 0 ? (
								<p className={ styles.notice }>{ __( 'No Blueprints found.' ) }</p>
							) : (
								<div className={ styles.grid }>{ filteredExplore.map( renderCard ) }</div>
							) }
						</>
					) }
				</>
			) }
		</section>
	);
}
