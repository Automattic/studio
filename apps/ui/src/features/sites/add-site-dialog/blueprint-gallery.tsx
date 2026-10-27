import { getBlueprintUseCases } from '@studio/common/lib/blueprint-catalog';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
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
} from '@/lib/ui';
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
						<PreviewFrame className={ styles.blank }>
							<PlusIcon />
						</PreviewFrame>
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
							<PreviewFrame className={ styles.frame }>
								<PreviewImage
									src={ blueprint.image }
									alt={ sprintf(
										// translators: %s is a Blueprint name.
										__( '%s preview' ),
										blueprint.title
									) }
									className={ styles.image }
								/>
							</PreviewFrame>
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
					<EmptyHeader>
						<EmptyDescription>{ __( 'No matching Blueprints.' ) }</EmptyDescription>
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
