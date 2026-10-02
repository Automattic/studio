import { SiteBadge } from '@/components/site-badge';
import { SitePrint } from '@/components/site-print';
import { useIsBusy, useSendPrompt } from '@/data/queries/use-host-actions';
import { useOpenSite } from '@/hooks/use-open-site';
import { NEW_SITE_DRAFT, NEW_SITE_PROMPT } from '@/lib/next-steps';
import { hostname, liveUrl, siteName } from '@/lib/sites';
import type { SiteEntry } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteSectionProps {
	title: string;
	entries: SiteEntry[];
	empty: ReactNode;
	withNewSite?: boolean;
}

// One card per site: ruled rows in a narrow pane, a grid of previews from 34rem.
export function SiteSection( { title, entries, empty, withNewSite }: SiteSectionProps ) {
	return (
		<section className="section">
			<div className="section-head">
				<h2 className="section-title">{ title }</h2>
				{ entries.length > 0 && (
					<span className="note">
						{ entries.length } { entries.length === 1 ? 'site' : 'sites' }
					</span>
				) }
			</div>
			{ entries.length || withNewSite ? (
				<ul className="sites">
					{ entries.map( ( entry ) => (
						<li key={ entry.key }>
							<SiteCard entry={ entry } />
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

function SiteCard( { entry }: { entry: SiteEntry } ) {
	const openSite = useOpenSite();
	const url = liveUrl( entry );
	return (
		<button
			type="button"
			className="site-card"
			aria-label={ `Open ${ entry.site.name || 'site' }` }
			onClick={ () => openSite( entry.kind, entry.site.id ) }
		>
			<SitePrint entry={ entry } />
			<span className="card-copy">
				<span className="card-title">{ siteName( entry ) }</span>
				<span className="card-meta">
					<span className="card-host">{ url ? hostname( url ) : 'Not running' }</span>
					<SiteBadge entry={ entry } />
				</span>
			</span>
			<span className="card-end">
				<SiteBadge entry={ entry } />
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
