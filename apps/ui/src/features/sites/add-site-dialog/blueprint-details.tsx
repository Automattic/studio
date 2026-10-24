import { getBlueprintPreviewUrl } from '@studio/common/lib/blueprint-catalog';
import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PreviewFrame, PreviewImage } from '@/components/ui/preview-frame';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { ExternalLinkIcon } from '@/lib/icons/external-link-icon';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import styles from './blueprint-gallery.module.css';
import { useAddSite } from './context';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

function toSelectedBlueprint( blueprint: Blueprint ): SelectedBlueprint {
	return {
		slug: blueprint.slug,
		title: blueprint.title,
		excerpt: blueprint.excerpt,
		image: blueprint.image,
		blueprint: blueprint.blueprint as BlueprintV1Declaration,
		file: { name: blueprint.title, size: 0 },
		filePath: blueprint.filePath,
		bundleUrl: blueprint.bundle_url ?? undefined,
	};
}

/**
 * A Blueprint's screenshots, with Preview and Create site. Create site picks the
 * Blueprint's name and a free folder, and leaves the choice to the setup form
 * only when the Blueprint needs a domain or the folder isn't empty.
 */
export function BlueprintDetails( {
	blueprint,
	onSetup,
}: {
	blueprint: Blueprint;
	onSetup: () => void;
} ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const { actions, setProgress, pinNewSite } = useAddSite();
	const { data: sites } = useSites();
	const { generateProposedPath } = usePathValidator( sites );
	const createSite = useCreateSite();
	const createButton = useRef< HTMLButtonElement >( null );

	const create = useMutation( {
		mutationFn: async () => {
			const selected = toSelectedBlueprint( blueprint );
			const { requiresCustomDomain, siteName, ...settings } = extractFormValuesFromBlueprint(
				selected.blueprint
			);
			const name = await connector.generateNumberedSiteName(
				siteName || blueprint.title,
				sites ?? []
			);
			const location = await generateProposedPath( name );
			if ( requiresCustomDomain || settings.customDomain || ! location.isEmpty || location.error ) {
				pendingBlueprintSlot.set( selected );
				onSetup();
				return;
			}
			const site = await createSite.mutateAsync( {
				...settings,
				name,
				path: location.path,
				blueprint: {
					blueprint: updateBlueprintWithFormValues( selected.blueprint, {
						...settings,
						siteName: name,
					} ),
					filePath: selected.filePath,
					bundleUrl: selected.bundleUrl,
				},
			} );
			pinNewSite( site.id );
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		},
		onMutate: () => setProgress( __( 'Creating site…' ) ),
		onSettled: () => setProgress( null ),
	} );

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
								size="header"
								onClick={ () =>
									void connector.openExternalUrl( getBlueprintPreviewUrl( blueprint ) )
								}
							>
								<ExternalLinkIcon data-icon="inline-start" />
								{ __( 'Preview in browser' ) }
							</Button>
							<Button
								ref={ createButton }
								variant="accent"
								size="header"
								loading={ create.isPending }
								loadingAnnouncement={ __( 'Creating site' ) }
								onClick={ () => create.mutate() }
							>
								{ create.isPending ? __( 'Creating…' ) : __( 'Create site' ) }
							</Button>
						</>,
						actions
				  )
				: null }
			<div className={ styles.details }>
				{ create.error ? (
					<Alert variant="destructive">
						<AlertDescription>
							{ getErrorMessage( create.error ) ??
								__( 'WordPress Studio could not create the site.' ) }
						</AlertDescription>
					</Alert>
				) : null }
				<PreviewFrame>
					<PreviewImage
						src={ blueprint.image }
						alt={ sprintf(
							// translators: %s is a Blueprint name.
							__( '%s screenshot' ),
							blueprint.title
						) }
					/>
				</PreviewFrame>
			</div>
		</>
	);
}
