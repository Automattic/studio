import { SiteBadge } from '@/components/site-badge';
import { SitePrint } from '@/components/site-print';
import { useIsBusy, useSendPrompt } from '@/data/queries/use-host-actions';
import { NEW_SITE_DRAFT, NEW_SITE_PROMPT } from '@/lib/next-steps';
import { hostname, liveUrl, siteName } from '@/lib/sites';
import type { LocalSite } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteSectionProps {
	title: string;
	sites: LocalSite[];
	empty: ReactNode;
	withNewSite?: boolean;
	onOpen: ( site: LocalSite ) => void;
}

// One card per site: ruled rows in a narrow pane, a grid of previews from 34rem.
export function SiteSection( { title, sites, empty, withNewSite, onOpen }: SiteSectionProps ) {
	return (
		<section className="section">
			<div className="section-head">
				<h2 className="section-title">{ title }</h2>
				{ sites.length > 0 && (
					<span className="note">
						{ sites.length } { sites.length === 1 ? 'site' : 'sites' }
					</span>
				) }
			</div>
			{ sites.length || withNewSite ? (
				<ul className="sites">
					{ sites.map( ( site ) => (
						<li key={ site.id }>
							<SiteCard site={ site } onOpen={ onOpen } />
						</li>
					) ) }
					{ withNewSite && (
						<li>
							<NewSiteCard />
						</li>
					) }
				</ul>
			) : (
				empty
			) }
		</section>
	);
}

function SiteCard( { site, onOpen }: { site: LocalSite; onOpen: ( site: LocalSite ) => void } ) {
	const url = liveUrl( site );
	return (
		<button
			type="button"
			className="site-card"
			aria-label={ `Open ${ site.name || 'site' }` }
			onClick={ () => onOpen( site ) }
		>
			<SitePrint site={ site } />
			<span className="card-copy">
				<span className="card-title">{ siteName( site ) }</span>
				<span className="card-meta">
					<span className="card-host">{ url ? hostname( url ) : 'Not running' }</span>
					<SiteBadge site={ site } />
				</span>
			</span>
			<span className="card-end">
				<SiteBadge site={ site } />
			</span>
		</button>
	);
}

function NewSiteCard() {
	const sendPrompt = useSendPrompt();
	const busy = useIsBusy();
	return (
		<button
			type="button"
			className="site-card add-card"
			aria-label="Create a new local site"
			disabled={ busy }
			onClick={ () => sendPrompt.mutate( { prompt: NEW_SITE_PROMPT, draft: NEW_SITE_DRAFT } ) }
		>
			<span className="add-print" />
			<span className="card-copy">
				<span className="card-title">New site</span>
				<span className="card-meta">
					<span className="card-host">Describe it in the chat</span>
				</span>
			</span>
		</button>
	);
}
