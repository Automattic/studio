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
import { formatDate, hostname, liveUrl, siteName } from '@/lib/sites';
import type { SiteEntry } from '@/data/core';

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

function siteFacts( entry: SiteEntry ): { facts: Fact[]; more: Fact[] } {
	if ( entry.kind === 'local' ) {
		const site = entry.site;
		return {
			facts: [
				[ 'Status', site.running ? 'Running' : 'Stopped' ],
				[ 'Lives on', 'This computer' ],
				[ 'PHP', site.phpVersion ],
			],
			more: [
				[ 'Folder', site.path, true ],
				[ 'Site ID', site.id, true ],
			],
		};
	}
	const site = entry.site;
	return {
		facts: [
			[ 'Plan', site.planName || 'WordPress.com' ],
			[ 'Environment', site.isStaging ? 'Staging' : 'Production' ],
			[ 'Last pulled', formatDate( site.lastPullTimestamp ) ],
			[ 'Last pushed', formatDate( site.lastPushTimestamp ) ],
		],
		more: [
			[ 'Site ID', String( site.id ), true ],
			[ 'Created', formatDate( site.createdAt ) ],
		],
	};
}

// An opened site: preview and facts side by side on a wide page, then the next steps.
export function SiteDetail( { entry }: { entry: SiteEntry } ) {
	const { context, capabilities } = useHostState();
	const busy = useIsBusy();
	const sendPrompt = useSendPrompt();
	const setRunning = useSetSiteRunning();
	const addToChat = useAddToChat();
	const [ status, setStatus ] = useState( '' );
	const url = liveUrl( entry );
	const { facts, more } = siteFacts( entry );
	const dashboardHost = entry.kind === 'wpcom' ? hostname( entry.site.url ) : '';

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
		if ( entry.kind !== 'local' ) {
			return;
		}
		setStatus( running ? 'Starting the site…' : 'Stopping the site…' );
		try {
			await setRunning.mutateAsync( { entry, running } );
			setStatus( running ? 'The site is running.' : 'The site is stopped.' );
		} catch {
			setStatus( running ? 'The site could not start.' : 'The site could not stop.' );
		}
	};
	const attach = async () => {
		try {
			await addToChat.mutateAsync( entry );
			setStatus( 'Added to this chat.' );
		} catch {
			setStatus( 'The site could not be added to chat.' );
		}
	};

	return (
		<section className="detail" aria-label="Selected site">
			<div className="detail-heading">
				<div className="detail-titles">
					<h2 className={ isPage( context ) ? 'page-title' : 'title' }>{ siteName( entry ) }</h2>
					{ url ? (
						<ExternalLink className="detail-host" href={ url }>
							{ hostname( url ) }
						</ExternalLink>
					) : (
						<span className="detail-host">Not running</span>
					) }
				</div>
				<SiteBadge entry={ entry } />
			</div>
			<div className="detail-top">
				<div className="detail-hero">
					{ url ? (
						<ExternalLink href={ url } aria-label={ `Open ${ hostname( url ) }` }>
							<SitePrint entry={ entry } />
						</ExternalLink>
					) : (
						<SitePrint entry={ entry } />
					) }
				</div>
				<div className="detail-aside">
					<Facts facts={ facts } />
					{ more.some( ( [ , value ] ) => value ) && (
						<details>
							<summary>More details</summary>
							<Facts facts={ more } />
						</details>
					) }
					<div className="actions">
						{ entry.kind === 'local' && (
							<button
								type="button"
								data-kind={ entry.site.running ? 'secondary' : 'primary' }
								disabled={ busy }
								onClick={ () => void toggleRunning( ! entry.site.running ) }
							>
								{ entry.site.running ? 'Stop' : 'Start' }
							</button>
						) }
						{ entry.kind === 'local' && url && (
							<ExternalLink
								data-kind="secondary"
								href={ `${ url.replace( /\/$/, '' ) }/wp-admin/` }
							>
								WP Admin ↗
							</ExternalLink>
						) }
						{ dashboardHost && (
							<ExternalLink
								data-kind="secondary"
								href={ `https://wordpress.com/home/${ dashboardHost }` }
							>
								Dashboard ↗
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
				<NextSteps entry={ entry } disabled={ busy } onSend={ ( prompt ) => void send( prompt ) } />
			) }
			<p className="status-line" role="status" hidden={ ! status }>
				{ status }
			</p>
		</section>
	);
}
