import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { Composer } from '@/components/session-view/composer';
import { SiteDropdown } from '@/components/site-dropdown';
import { useConnector } from '@/data/core';
import { useCreateSession } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { AiModelId } from '@/data/core';

interface NewSessionViewProps {
	siteId: string;
}

/**
 * Blank "new session" surface for a given site. No session file exists yet —
 * the first prompt the user sends creates the session (via `createSession`)
 * then kicks off the run (via `continueSession`), after which the route swaps
 * to `/sessions/$sessionId` for the ordinary in-session view.
 */
export function NewSessionView( { siteId }: NewSessionViewProps ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const { data: sites } = useSites();
	const createSession = useCreateSession();

	const site = sites?.find( ( candidate ) => candidate.id === siteId );

	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
		: null;

	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );
	const [ model, setModel ] = useState< AiModelId >( () => resolveSessionModel( [] ) );

	const handleSend = async ( prompt: string ) => {
		if ( busy ) return;
		setBusy( true );
		setError( null );
		try {
			const summary = await createSession.mutateAsync( siteId );
			// Persist the picked model (even if it matches the default) so the
			// session carries the user's intent into the next render.
			await connector.setSessionModel( summary.id, model );
			await connector.continueSession( summary.id, prompt );
			await navigate( { to: '/sessions/$sessionId', params: { sessionId: summary.id } } );
		} catch ( e ) {
			setError(
				e instanceof Error
					? e.message
					: __( 'Could not start the session. Please try again.' )
			);
			setBusy( false );
		}
	};

	return (
		<div className={ styles.root }>
			<div className={ styles.header }>
				{ toggleSpacerClass ? (
					<span className={ toggleSpacerClass } aria-hidden="true" />
				) : null }
				{ site ? <SiteDropdown site={ site } /> : null }
			</div>
			<div className={ styles.scroll }>
				<div className={ styles.column }>
					<div className={ styles.greeting }>
						<h1 className={ styles.greetingTitle }>
							{ site
								? /* translators: %s: site name */ __( 'Start building with %s' ).replace(
										'%s',
										site.name
								  )
								: __( 'Start a new chat' ) }
						</h1>
						<p className={ styles.greetingBody }>
							{ __( 'Send a prompt to kick off your first session for this site.' ) }
						</p>
					</div>
				</div>
			</div>
			<div className={ styles.composerOuter }>
				<div className={ styles.column }>
					<Composer
						busy={ busy }
						error={ error }
						model={ model }
						onModelChange={ setModel }
						onSend={ handleSend }
						onInterrupt={ async () => {} }
					/>
				</div>
			</div>
		</div>
	);
}
