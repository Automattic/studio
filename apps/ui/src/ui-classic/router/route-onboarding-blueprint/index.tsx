import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useMemo, useState } from 'react';
import { BlueprintUpload } from '@/components/blueprint-upload';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useBlueprints } from '@/data/queries/use-blueprints';
import { useOffline } from '@/hooks/use-offline';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';
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
	};
}

function BlueprintCard( { blueprint, onClick }: { blueprint: Blueprint; onClick: () => void } ) {
	return (
		<button type="button" className={ styles.card } onClick={ onClick }>
			{ blueprint.image ? (
				<img
					src={ blueprint.image }
					alt={ blueprint.title }
					className={ styles.cardImage }
					loading="lazy"
				/>
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

function BlueprintGalleryPage() {
	const navigate = useNavigate();
	const isOffline = useOffline();
	const { data: blueprints, isLoading, isError } = useBlueprints();
	const [ searchQuery, setSearchQuery ] = useState( '' );
	const [ uploadedBlueprint, setUploadedBlueprint ] = useState< SelectedBlueprint | null >( null );

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
			const categories = ( bp.blueprint as Record< string, unknown > )?.meta as
				| Record< string, unknown >
				| undefined;
			const categoryList = ( categories?.categories ?? [] ) as string[];
			const categoryMatch = categoryList.some( ( cat ) => cat.toLowerCase().includes( query ) );
			return titleMatch || excerptMatch || categoryMatch;
		} );
	}, [ explore, searchQuery ] );

	const handleSelect = useCallback(
		( bp: Blueprint ) => {
			pendingBlueprintSlot.set( apiToSelectedBlueprint( bp ) );
			void navigate( { to: '/onboarding/create' } );
		},
		[ navigate ]
	);

	const handleUploadSelect = useCallback(
		( blueprint: SelectedBlueprint ) => {
			setUploadedBlueprint( blueprint );
			pendingBlueprintSlot.set( blueprint );
			void navigate( { to: '/onboarding/create' } );
		},
		[ navigate ]
	);

	return (
		<div className={ styles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Start from a Blueprint' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Choose a pre-built site template to get started quickly.' ) }
			</p>

			<div className={ styles.upload }>
				<BlueprintUpload
					selected={ uploadedBlueprint }
					onSelect={ handleUploadSelect }
					onRemove={ () => setUploadedBlueprint( null ) }
					onValidityChange={ () => undefined }
				/>
			</div>

			{ isLoading ? (
				<div className={ styles.loading }>
					<span>{ __( 'Loading blueprints…' ) }</span>
				</div>
			) : isError || isOffline ? (
				<div className={ styles.error }>
					{ __( 'Could not load blueprints. Check your internet connection and try again.' ) }
				</div>
			) : (
				<>
					<div className={ styles.grid }>
						{ featured.map( ( bp ) => (
							<BlueprintCard
								key={ bp.slug }
								blueprint={ bp }
								onClick={ () => handleSelect( bp ) }
							/>
						) ) }
					</div>

					{ explore.length > 0 && (
						<>
							<div className={ styles.exploreHeader }>
								<h2 className={ styles.exploreTitle }>{ __( 'Explore more blueprints' ) }</h2>
								<input
									type="search"
									className={ styles.searchInput }
									placeholder={ __( 'Search blueprints' ) }
									value={ searchQuery }
									onChange={ ( e ) => setSearchQuery( e.target.value ) }
								/>
							</div>
							{ filteredExplore.length === 0 ? (
								<div className={ styles.empty }>{ __( 'No blueprints found.' ) }</div>
							) : (
								<div className={ styles.grid }>
									{ filteredExplore.map( ( bp ) => (
										<BlueprintCard
											key={ bp.slug }
											blueprint={ bp }
											onClick={ () => handleSelect( bp ) }
										/>
									) ) }
								</div>
							) }
						</>
					) }
				</>
			) }

			<OnboardingFooter>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					onClick={ () => void navigate( { to: '/onboarding' } ) }
				>
					<Icon icon={ chevronLeft } size={ 16 } />
					<span>{ __( 'Back' ) }</span>
				</Button>
			</OnboardingFooter>
		</div>
	);
}

export const onboardingBlueprintRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/blueprint',
	component: BlueprintGalleryPage,
} );
