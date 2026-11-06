import { getBlueprintUseCases } from '@studio/common/lib/blueprint-catalog';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { useBlueprints } from '@/data/queries/use-blueprints';
import { useOffline } from '@/lib/hooks';
import { PlusIcon } from '@/lib/icons';
import {
	Button,
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	PreviewFrame,
	PreviewImage,
	Spinner,
} from '@/lib/ui';
import styles from './blueprint-gallery.module.css';
import { getBlueprintThumbnail } from './blueprint-screenshots';
import dialogStyles from './style.module.css';
import type { BlueprintUseCase } from '@studio/common/lib/blueprint-catalog';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

export function getUseCases(): { value: BlueprintUseCase; label: string }[] {
	return [
		{ value: 'business', label: __( 'Business' ) },
		{ value: 'blog', label: __( 'Blog' ) },
		{ value: 'portfolio', label: __( 'Portfolio' ) },
		{ value: 'store', label: __( 'Store' ) },
		{ value: 'events', label: __( 'Events' ) },
		{ value: 'development', label: __( 'Development' ) },
	];
}

export function getUseCaseLabel( useCase: BlueprintUseCase ) {
	return getUseCases().find( ( item ) => item.value === useCase )?.label ?? useCase;
}

export function BlueprintGallery( {
	useCase,
	focusSlug,
	onClearFilters,
	onBlank,
	onView,
}: {
	useCase?: BlueprintUseCase;
	// The Blueprint to focus, when coming back from its details.
	focusSlug?: string;
	onClearFilters: () => void;
	onBlank: () => void;
	onView: ( blueprint: Blueprint ) => void;
} ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const root = useRef< HTMLDivElement >( null );
	const { data: blueprints, isLoading, isError, isSuccess } = useBlueprints();
	const items = ( blueprints ?? [] )
		.filter( ( blueprint ) => ! useCase || getBlueprintUseCases( blueprint ).includes( useCase ) )
		.sort( ( a, b ) => Number( b.slug === 'substrata' ) - Number( a.slug === 'substrata' ) );

	useEffect( () => {
		root.current
			?.querySelector< HTMLElement >(
				focusSlug ? `[data-blueprint-slug="${ focusSlug }"]` : '[data-start-blank]'
			)
			?.focus( { preventScroll: ! focusSlug } );
	}, [ focusSlug, isLoading ] );

	if ( isLoading ) {
		return (
			<div className={ dialogStyles.loading }>
				<Spinner aria-label={ __( 'Loading sites…' ) } />
			</div>
		);
	}

	return (
		<div ref={ root } className={ styles.root }>
			{ ! blueprints?.length && ( isError || isOffline ) ? (
				<p className={ styles.notice }>
					{ __( 'Sites could not be loaded. Check your internet connection and try again.' ) }
				</p>
			) : null }
			<div className={ styles.grid }>
				{ ! useCase ? (
					<button
						type="button"
						className={ styles.card }
						data-start-blank
						data-walkthrough="create"
						aria-label={ __( 'Start with Blank site' ) }
						onClick={ () => {
							void connector
								.trackEvent( TRACKS_EVENTS.BLANK_SITE_SELECTED, {
									placement: 'add_site_blueprint_gallery',
								} )
								.catch( () => undefined );
							onBlank();
						} }
					>
						<PreviewFrame className={ styles.blank }>
							<span className={ styles.blankIcon }>
								<PlusIcon />
							</span>
						</PreviewFrame>
						<span className={ styles.cardTitle }>{ __( 'Blank site' ) }</span>
					</button>
				) : null }
				{ items.map( ( blueprint, index ) => (
					<button
						key={ blueprint.slug }
						type="button"
						className={ styles.card }
						data-blueprint-slug={ blueprint.slug }
						data-walkthrough={ index === 0 ? 'create-design' : undefined }
						aria-label={ sprintf(
							// translators: %s is a Blueprint name.
							__( 'View %s' ),
							blueprint.title
						) }
						onClick={ () => {
							void connector
								.trackEvent( TRACKS_EVENTS.BLUEPRINT_VIEWED, {
									blueprint_slug: blueprint.slug,
									...( useCase ? { use_case: useCase } : {} ),
								} )
								.catch( () => undefined );
							onView( blueprint );
						} }
					>
						<span className={ styles.thumbnail }>
							<PreviewFrame className={ styles.thumbnailFrame }>
								<PreviewImage
									src={ getBlueprintThumbnail( blueprint ) }
									alt={ sprintf(
										// translators: %s is a Blueprint name.
										__( '%s preview' ),
										blueprint.title
									) }
									className={ styles.image }
								/>
							</PreviewFrame>
							<span className={ styles.action } aria-hidden="true">
								<span className={ styles.actionLabel }>{ __( 'View site' ) }</span>
							</span>
						</span>
						<span className={ styles.cardTitle }>{ blueprint.title }</span>
					</button>
				) ) }
			</div>
			{ isSuccess && useCase && ! items.length ? (
				<Empty>
					<EmptyHeader>
						<EmptyDescription>{ __( 'No matching sites.' ) }</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button variant="outline" onClick={ onClearFilters }>
							{ __( 'Clear filters' ) }
						</Button>
					</EmptyContent>
				</Empty>
			) : null }
		</div>
	);
}
