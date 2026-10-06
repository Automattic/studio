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
import type { LocalSite } from '@/data/core';

type Fact = [ label: string, value: string | undefined, mono?: boolean ];

function Facts( { facts }: { facts: Fact[] } ) {
	return (
		<dl className="facts">
			{ facts
				.filter( ( [ , value ] ) => value )
				.map( ( [ label, value, mono ] ) => (
					<div key={ label }>
						<dt>{ label }</dt>
						<dd data-mono={ mono ? '' : undefined }>{ value }</dd>
					</div>
				) ) }
		</dl>
	);
}

// An opened site: preview and facts side by side on a wide page, then the next steps.
export function SiteDetail( { site }: { site: LocalSite } ) {
	const { context, capabilities } = useHostState();
	const busy = useIsBusy();
	const sendPrompt = useSendPrompt();
	const setRunning = useSetSiteRunning();
	const addToChat = useAddToChat();
	const [ status, setStatus ] = useState( '' );
	const url = liveUrl( site );

	const send = async ( prompt: string ) => {
		setStatus( 'Sending to chat…' );
		try {
			await sendPrompt.mutateAsync( { prompt } );
			setStatus( 'Sent to chat.' );
		} catch {
			setStatus( 'The message could not be sent. Try again.' );
		}
	};
	const toggleRunning = async ( running: boolean ) => {
		setStatus( running ? 'Starting the site…' : 'Stopping the site…' );
		try {
			await setRunning.mutateAsync( { site, running } );
			setStatus( running ? 'The site is running.' : 'The site is stopped.' );
		} catch {
			setStatus( running ? 'The site could not start.' : 'The site could not stop.' );
		}
	};
	const attach = async () => {
		try {
			await addToChat.mutateAsync( site );
			setStatus( 'Added to this chat.' );
		} catch {
			setStatus( 'The site could not be added to chat.' );
		}
	};

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
					<Facts
						facts={ [
							[ 'Status', site.running ? 'Running' : 'Stopped' ],
							[ 'Lives on', 'This computer' ],
							[ 'PHP', site.phpVersion ],
						] }
					/>
					<details>
						<summary>More details</summary>
						<Facts
							facts={ [
								[ 'Folder', site.path, true ],
								[ 'Site ID', site.id, true ],
							] }
						/>
					</details>
					<div className="actions">
						<button
							type="button"
							data-kind={ site.running ? 'secondary' : 'primary' }
							disabled={ busy }
							onClick={ () => void toggleRunning( ! site.running ) }
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
							<button type="button" data-kind="secondary" onClick={ () => void attach() }>
								Add to chat
							</button>
						) }
					</div>
				</div>
			</div>
			{ canMessage( capabilities ) && (
				<NextSteps site={ site } disabled={ busy } onSend={ ( prompt ) => void send( prompt ) } />
			) }
			<p className="status-line" role="status" hidden={ ! status }>
				{ status }
			</p>
		</section>
	);
}
