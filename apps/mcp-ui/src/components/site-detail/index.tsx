import { useState } from 'react';
import { ExternalLink } from '@/components/external-link';
import { NextSteps } from '@/components/next-steps';
import { SiteBadge } from '@/components/site-badge';
import { SitePrint } from '@/components/site-print';
import {
	useAddToChat,
	useIsBusy,
	useSendPrompt,
	useSetSiteRunning,
} from '@/data/queries/use-host-actions';
import { useHostState } from '@/hooks/use-host-state';
import { canAttach, canMessage, isPage } from '@/lib/host-capabilities';
import { hostname, liveUrl, siteName } from '@/lib/sites';
import type { LocalSite } from '@/data/types';

// An opened site: preview and facts side by side on a wide page, then the next steps.
export function SiteDetail( { site }: { site: LocalSite } ) {
	const { context, capabilities } = useHostState();
	const busy = useIsBusy();
	const sendPrompt = useSendPrompt();
	const setRunning = useSetSiteRunning();
	const addToChat = useAddToChat();
	const [ status, setStatus ] = useState( '' );
	const url = liveUrl( site );

	const report = ( action: Promise< unknown >, done = '' ) =>
		void action.then(
			() => setStatus( done ),
			( error: Error ) => setStatus( error.message )
		);

	return (
		<section className="detail" aria-label="Selected site">
			<div className="detail-heading">
				<div className="detail-titles">
					<h2 className={ isPage( context ) ? 'page-title' : 'title' }>{ siteName( site ) }</h2>
					{ url ? (
						<ExternalLink className="detail-host" href={ url }>
							{ hostname( url ) }
						</ExternalLink>
					) : (
						<span className="detail-host">Not running</span>
					) }
				</div>
				<SiteBadge site={ site } />
			</div>
			<div className="detail-top">
				<div className="detail-hero">
					{ url ? (
						<ExternalLink href={ url } aria-label={ `Open ${ hostname( url ) }` }>
							<SitePrint site={ site } />
						</ExternalLink>
					) : (
						<SitePrint site={ site } />
					) }
				</div>
				<div className="detail-aside">
					<dl className="facts">
						{ site.phpVersion && (
							<div>
								<dt>PHP</dt>
								<dd>{ site.phpVersion }</dd>
							</div>
						) }
						<div>
							<dt>Folder</dt>
							<dd data-mono="">{ site.path }</dd>
						</div>
					</dl>
					<div className="actions">
						<button
							type="button"
							data-kind={ site.running ? 'secondary' : 'primary' }
							disabled={ busy }
							onClick={ () =>
								report( setRunning.mutateAsync( { site, running: ! site.running } ) )
							}
						>
							{ site.running ? 'Stop' : 'Start' }
						</button>
						{ url && (
							<ExternalLink
								data-kind="secondary"
								href={ `${ url.replace( /\/$/, '' ) }/wp-admin/` }
							>
								WP Admin ↗
							</ExternalLink>
						) }
						{ canAttach( capabilities ) && (
							<button
								type="button"
								data-kind="secondary"
								onClick={ () => report( addToChat.mutateAsync( site ), 'Added to this chat.' ) }
							>
								Add to chat
							</button>
						) }
					</div>
				</div>
			</div>
			{ canMessage( capabilities ) && (
				<NextSteps
					site={ site }
					disabled={ busy }
					onSend={ ( prompt ) => report( sendPrompt.mutateAsync( { prompt } ), 'Sent to chat.' ) }
				/>
			) }
			<p className="status-line" role="status" hidden={ ! status }>
				{ status }
			</p>
		</section>
	);
}
