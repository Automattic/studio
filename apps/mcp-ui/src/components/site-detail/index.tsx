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
import { canAttach, canMessage, canTargetMessages, isPage } from '@/lib/host-capabilities';
import { formatDate, hostname, liveUrl, siteName } from '@/lib/sites';
import type { SiteEntry } from '@/data/types';

type Fact = [ label: string, value: string | undefined, mono?: boolean ];

const factsOf = ( { kind, site }: SiteEntry ): Fact[] =>
	kind === 'local'
		? [
				[ 'PHP', site.phpVersion ],
				[ 'Folder', site.path, true ],
		  ]
		: [
				[ 'Plan', site.planName ],
				[ 'Last pulled', formatDate( site.lastPullTimestamp ) ],
				[ 'Last pushed', formatDate( site.lastPushTimestamp ) ],
		  ];

// An opened site: preview and facts side by side on a wide page, then the next steps.
export function SiteDetail( { entry }: { entry: SiteEntry } ) {
	const { context, capabilities } = useHostState();
	const busy = useIsBusy();
	const sendPrompt = useSendPrompt();
	const setRunning = useSetSiteRunning();
	const addToChat = useAddToChat();
	const [ status, setStatus ] = useState( '' );
	const url = liveUrl( entry );

	const report = ( action: Promise< unknown >, done = '' ) =>
		void action.then(
			() => setStatus( done ),
			( error: Error ) => setStatus( error.message )
		);

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
					<dl className="facts">
						{ factsOf( entry )
							.filter( ( [ , value ] ) => value )
							.map( ( [ label, value, mono ] ) => (
								<div key={ label }>
									<dt>{ label }</dt>
									<dd data-mono={ mono ? '' : undefined }>{ value }</dd>
								</div>
							) ) }
					</dl>
					<div className="actions">
						{ entry.kind === 'local' && (
							<button
								type="button"
								data-kind={ entry.site.running ? 'secondary' : 'primary' }
								disabled={ busy }
								onClick={ () =>
									report(
										setRunning.mutateAsync( { site: entry.site, running: ! entry.site.running } )
									)
								}
							>
								{ entry.site.running ? 'Stop' : 'Start' }
							</button>
						) }
						{ url && (
							<ExternalLink
								data-kind="secondary"
								href={
									entry.kind === 'local'
										? `${ url.replace( /\/$/, '' ) }/wp-admin/`
										: `https://wordpress.com/home/${ hostname( url ) }`
								}
							>
								{ entry.kind === 'local' ? 'WP Admin ↗' : 'Dashboard ↗' }
							</ExternalLink>
						) }
						{ canAttach( capabilities ) && (
							<button
								type="button"
								data-kind="secondary"
								onClick={ () => report( addToChat.mutateAsync( entry ), 'Added to this chat.' ) }
							>
								Add to chat
							</button>
						) }
					</div>
				</div>
			</div>
			{ canMessage( capabilities ) && (
				<NextSteps
					entry={ entry }
					disabled={ busy }
					onSend={ ( prompt ) =>
						report(
							sendPrompt.mutateAsync( { prompt } ),
							canTargetMessages( capabilities ) ? 'Opened in a new chat.' : 'Sent to chat.'
						)
					}
				/>
			) }
			<p className="status-line" role="status" hidden={ ! status }>
				{ status }
			</p>
		</section>
	);
}
