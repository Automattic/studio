import { __ } from '@wordpress/i18n';
import { upload } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useBlueprints } from '@/data/queries/use-blueprints';
import { useOffline } from '@/hooks/use-offline';
import { BLUEPRINT_FILE_ACCEPT, loadBlueprintFile } from '@/lib/load-blueprint-file';
import styles from './style.module.css';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

const SEARCH_THRESHOLD = 8;

const BLUEPRINT_DISPLAY_NAMES: Record< string, string > = {
	'Quick Start': 'WordPress.com',
	Development: 'Theme & plugin development',
	Commerce: 'WooCommerce',
	'Stylish Press': 'WooCommerce starter store',
};

function getBlueprintExcerptOverrides(): Record< string, string > {
	return {
		'Quick Start': __(
			'A WordPress.com-like environment with Business plan plugins and themes pre-installed.'
		),
		Commerce: __(
			'Create your next online store with WooCommerce and its companion plugins pre-installed.'
		),
		Development: __(
			'Query Monitor, Plugin Check, Theme Check, and Create Block Theme pre-installed.'
		),
		'Stylish Press': __(
			'A ready-made WooCommerce store with a custom theme, sample content, and products.'
		),
	};
}

const PINNED_BLUEPRINT_SLUGS = [ 'development', 'quick-start', 'woo-shop' ];
const PINNED_BLUEPRINT_ORDER = new Map(
	PINNED_BLUEPRINT_SLUGS.map( ( slug, index ) => [ slug, index ] )
);

function renameBlueprintsForDisplay( blueprints: Blueprint[] ): Blueprint[] {
	const excerptOverrides = getBlueprintExcerptOverrides();
	return [ ...blueprints ]
		.sort(
			( a, b ) =>
				( PINNED_BLUEPRINT_ORDER.get( a.slug ) ?? Number.MAX_SAFE_INTEGER ) -
				( PINNED_BLUEPRINT_ORDER.get( b.slug ) ?? Number.MAX_SAFE_INTEGER )
		)
		.map( ( item ) => ( {
			...item,
			excerpt: excerptOverrides[ item.title ] || item.excerpt,
			title: BLUEPRINT_DISPLAY_NAMES[ item.title ] || item.title,
		} ) );
}

function apiToSelectedBlueprint( bp: Blueprint ): SelectedBlueprint {
	return {
		slug: bp.slug,
		title: bp.title,
		excerpt: bp.excerpt,
		image: bp.image,
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
				<div className={ styles.cardImageViewport }>
					<img src={ blueprint.image } alt="" className={ styles.cardImage } loading="lazy" />
				</div>
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

function UploadBlueprintButton( { onSelect }: { onSelect: ( bp: SelectedBlueprint ) => void } ) {
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
			<Button
				type="button"
				variant="outline"
				tone="neutral"
				size="small"
				className={ clsx( styles.uploadButton, isDragging && styles.uploadButtonDragging ) }
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
				<Icon icon={ upload } size={ 16 } />
				<span>{ isReading ? __( 'Reading Blueprint…' ) : __( 'Upload a Blueprint' ) }</span>
			</Button>
			{ error && (
				<span role="alert" className={ styles.uploadError }>
					{ error }
				</span>
			) }
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
	const displayBlueprints = useMemo(
		() => renameBlueprintsForDisplay( blueprints ?? [] ),
		[ blueprints ]
	);

	const filteredBlueprints = useMemo( () => {
		const query = searchQuery.toLowerCase().trim();
		if ( ! query ) {
			return displayBlueprints;
		}
		return displayBlueprints.filter( ( bp ) => {
			const titleMatch = bp.title.toLowerCase().includes( query );
			const excerptMatch = bp.excerpt.toLowerCase().includes( query );
			const meta = ( bp.blueprint as Record< string, unknown > )?.meta as
				| Record< string, unknown >
				| undefined;
			const categoryList = ( meta?.categories ?? [] ) as string[];
			const categoryMatch = categoryList.some( ( cat ) => cat.toLowerCase().includes( query ) );
			return titleMatch || excerptMatch || categoryMatch;
		} );
	}, [ displayBlueprints, searchQuery ] );

	const renderCard = ( bp: Blueprint ) => (
		<BlueprintCard
			key={ bp.slug }
			blueprint={ bp }
			onClick={ () => onSelect( apiToSelectedBlueprint( bp ) ) }
		/>
	);

	return (
		<section className={ styles.root } aria-labelledby="blueprint-gallery-heading">
			<div className={ styles.sectionHeader }>
				<h2 id="blueprint-gallery-heading" className={ styles.heading }>
					{ __( 'Start from a Blueprint' ) }
				</h2>
				<div className={ styles.sectionActions }>
					{ displayBlueprints.length > SEARCH_THRESHOLD && (
						<input
							type="search"
							className={ styles.searchInput }
							placeholder={ __( 'Search Blueprints' ) }
							aria-label={ __( 'Search Blueprints' ) }
							value={ searchQuery }
							onChange={ ( event ) => setSearchQuery( event.target.value ) }
						/>
					) }
					<UploadBlueprintButton onSelect={ onSelect } />
				</div>
			</div>

			{ isLoading ? (
				<p className={ styles.notice }>{ __( 'Loading Blueprints…' ) }</p>
			) : displayBlueprints.length === 0 && ( isError || isOffline ) ? (
				<p className={ styles.notice }>
					{ __( 'Blueprints could not be loaded. Check your internet connection and try again.' ) }
				</p>
			) : filteredBlueprints.length === 0 ? (
				<p className={ styles.notice }>{ __( 'No Blueprints found.' ) }</p>
			) : (
				<div className={ styles.grid }>{ filteredBlueprints.map( renderCard ) }</div>
			) }
		</section>
	);
}
