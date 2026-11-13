import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { toSelectedBlueprint } from '@/features/sites/blueprint-selection';
import { ExternalLinkIcon } from '@/lib/icons';
import { PreviewFrame, PreviewImage, Button } from '@/lib/ui';
import { getBlueprintPreviewUrl } from './blueprint-catalog';
import styles from './blueprint-gallery.module.css';
import { getBlueprintScreenshots } from './blueprint-screenshots';
import { useAddSite } from './context';
import type { BlueprintUseCase } from './blueprint-catalog';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { LibraryBlueprint } from '@studio/blueprints';

export function BlueprintDetails( {
	blueprint,
	useCase,
	choosingBlueprint,
	busy,
	onSelect,
}: {
	blueprint: LibraryBlueprint;
	useCase?: BlueprintUseCase;
	choosingBlueprint: boolean;
	busy: boolean;
	onSelect: ( blueprint: SelectedBlueprint ) => void;
} ) {
	const connector = useConnector();
	const { actions } = useAddSite();
	const createButton = useRef< HTMLButtonElement >( null );

	useEffect( () => {
		createButton.current?.focus();
	}, [ actions ] );

	return (
		<>
			{ actions
				? createPortal(
						<>
							<Button
								variant="outline"
								size="sm"
								disabled={ busy }
								onClick={ () => {
									void connector
										.trackEvent( TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER, {
											blueprint_slug: blueprint.slug,
											...( useCase ? { use_case: useCase } : {} ),
											placement: 'add_site_blueprint_details',
										} )
										.catch( () => undefined );
									void connector.openExternalUrl( getBlueprintPreviewUrl( blueprint ) );
								} }
							>
								<ExternalLinkIcon data-icon="inline-start" />
								{ __( 'Preview in browser' ) }
							</Button>
							<Button
								ref={ createButton }
								variant="accent"
								size="sm"
								loading={ busy }
								loadingAnnouncement={ __( 'Adding site' ) }
								onClick={ () => {
									void connector
										.trackEvent( TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT, {
											blueprint_slug: blueprint.slug,
											...( useCase ? { use_case: useCase } : {} ),
											placement: 'add_site_blueprint_details',
										} )
										.catch( () => undefined );
									onSelect( toSelectedBlueprint( blueprint ) );
								} }
							>
								{ choosingBlueprint ? __( 'Use Blueprint' ) : __( 'Add site' ) }
							</Button>
						</>,
						actions
				  )
				: null }
			<div className={ styles.details }>
				<div className={ styles.screenshots }>
					{ getBlueprintScreenshots( blueprint ).map( ( src, index ) => (
						<PreviewFrame key={ src }>
							<PreviewImage
								src={ src }
								alt={ sprintf(
									// translators: %1$s is a Blueprint name, %2$d is the screenshot number.
									index === 0 ? __( '%s screenshot' ) : __( '%1$s screenshot %2$d' ),
									blueprint.title,
									index + 1
								) }
							/>
						</PreviewFrame>
					) ) }
				</div>
			</div>
		</>
	);
}
