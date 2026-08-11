import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useCallback, useRef, useState } from 'react';
import { useFindAvailableSiteName } from '@/data/queries/use-create-site-helpers';
import { useCreateSite } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { setPendingSessionPrompt } from '@/lib/pending-session-prompt';
import { Composer } from '../../components/session-view/composer';
import { WizardPage } from '../../components/wizard-page';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from './style.module.css';
import type { ComposerSendAttachments } from '../../components/session-view/composer/use-composer-attachments';

/**
 * Onboarding AI brief: describe what you want (optionally attaching images
 * or files) in the same composer the chat view uses. Sending creates a
 * fresh local site and hands the brief to a new agent session, which
 * auto-sends it and starts building — the same pending-prompt handoff the
 * plugin flow uses.
 */
export function OnboardingAiPage() {
	const navigate = useNavigate();
	const createSite = useCreateSite();
	const findAvailableSiteName = useFindAvailableSiteName();
	const [ error, setError ] = useState< string | null >( null );
	const submittingRef = useRef( false );
	const { data: preferences } = useUserPreferences();

	const handleSend = useCallback(
		async ( prompt: string, attachments?: ComposerSendAttachments ) => {
			if ( submittingRef.current ) {
				return;
			}
			submittingRef.current = true;
			setError( null );
			try {
				const { name, path } = await findAvailableSiteName( __( 'My first site' ) );
				const site = await createSite.mutateAsync( { name, path } );
				setPendingSessionPrompt( {
					siteId: site.id,
					prompt,
					images: attachments?.images,
					files: attachments?.files,
				} );
				void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
			} catch ( sendError ) {
				setError( __( 'Failed to create site. Please try again.' ) );
				// Rethrow so the composer restores the draft and attachments.
				throw sendError;
			} finally {
				submittingRef.current = false;
			}
		},
		[ createSite, findAvailableSiteName, navigate ]
	);

	return (
		<WizardPage
			title={ __( 'What should we build?' ) }
			subtitle={ __( 'Describe your idea and Studio Code will set up a site and start building.' ) }
			onBack={ () => void navigate( { to: '/onboarding' } ) }
		>
			<div className={ styles.composerHost }>
				<Composer
					busy={ createSite.isPending }
					model={ preferences?.defaultAiModel ?? DEFAULT_MODEL }
					onSend={ handleSend }
					onInterrupt={ async () => undefined }
					autoFocus
				/>
				{ error && (
					<p role="alert" className={ styles.error }>
						{ error }
					</p>
				) }
			</div>
		</WizardPage>
	);
}

export const onboardingAiRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/ai',
	// The agent needs a WordPress.com login; this guard covers deep links.
	beforeLoad: async ( { context } ) => {
		const authenticated = await context.connector.isAuthenticated();
		if ( ! authenticated ) {
			throw redirect( { to: '/onboarding' } );
		}
	},
	component: OnboardingAiPage,
} );
