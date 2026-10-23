import { getBlueprintUseCases } from '@studio/common/lib/blueprint-catalog';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { useBlueprints } from '@/data/queries/use-blueprints';
import { useOffline } from '@/hooks/use-offline';
import { plusIcon } from '@/lib/icons';
import styles from './blueprint-gallery.module.css';
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

// A 16:10 screenshot with a skeleton while it loads or when it's missing.
export function BlueprintScreenshot( { url, alt }: { url?: string; alt: string } ) {
	const [ state, setState ] = useState< 'loading' | 'ready' | 'error' >( 'loading' );
	return (
		<span className={ styles.frame }>
			{ url && state !== 'error' ? (
				<img
					src={ url }
					alt={ alt }
					className={ styles.image }
					onLoad={ () => setState( 'ready' ) }
					onError={ () => setState( 'error' ) }
				/>
			) : null }
			{ ! url || state !== 'ready' ? (
				<span className={ styles.skeleton } aria-hidden="true" />
			) : null }
		</span>
	);
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
	const isOffline = useOffline();
	const root = useRef< HTMLDivElement >( null );
	const { data: blueprints, isLoading, isError, isSuccess } = useBlueprints();
	const items = ( blueprints ?? [] ).filter(
		( blueprint ) => ! useCase || getBlueprintUseCases( blueprint ).includes( useCase )
	);

	useEffect( () => {
		root.current
			?.querySelector< HTMLElement >(
				focusSlug ? `[data-blueprint-slug="${ focusSlug }"]` : '[data-start-blank]'
			)
			?.focus( { preventScroll: ! focusSlug } );
	}, [ focusSlug ] );

	return (
		<div ref={ root } className={ styles.root }>
			{ ! blueprints?.length && ( isError || isOffline ) ? (
				<p className={ styles.notice }>
					{ __( 'Blueprints could not be loaded. Check your internet connection and try again.' ) }
				</p>
			) : null }
			{ isLoading ? (
				<p className={ styles.notice } role="status">
					{ __( 'Loading Blueprints…' ) }
				</p>
			) : null }
			<div className={ styles.grid }>
				{ ! useCase ? (
					<button
						type="button"
						className={ styles.card }
						data-start-blank
						aria-label={ __( 'Start with Blank site' ) }
						onClick={ onBlank }
					>
						<span className={ `${ styles.frame } ${ styles.blank }` }>{ plusIcon }</span>
						<span className={ styles.cardTitle }>{ __( 'Blank site' ) }</span>
					</button>
				) : null }
				{ items.map( ( blueprint ) => (
					<button
						key={ blueprint.slug }
						type="button"
						className={ styles.card }
						data-blueprint-slug={ blueprint.slug }
						aria-label={ sprintf(
							// translators: %s is a Blueprint name.
							__( 'View %s' ),
							blueprint.title
						) }
						onClick={ () => onView( blueprint ) }
					>
						<span className={ styles.thumbnail }>
							<BlueprintScreenshot
								url={ blueprint.image }
								alt={ sprintf(
									// translators: %s is a Blueprint name.
									__( '%s preview' ),
									blueprint.title
								) }
							/>
							<span className={ styles.action } aria-hidden="true">
								<span className={ styles.actionLabel }>{ __( 'View blueprint' ) }</span>
							</span>
						</span>
						<span className={ styles.cardTitle }>{ blueprint.title }</span>
					</button>
				) ) }
			</div>
			{ isSuccess && useCase && ! items.length ? (
				<Empty>
					<EmptyDescription>{ __( 'No matching Blueprints.' ) }</EmptyDescription>
					<Button variant="outline" onClick={ onClearFilters }>
						{ __( 'Clear filters' ) }
					</Button>
				</Empty>
			) : null }
		</div>
	);
}
