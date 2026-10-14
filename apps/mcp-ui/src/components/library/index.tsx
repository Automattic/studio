import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FailureNotice } from '@/components/failure-notice';
import { LibraryHeader } from '@/components/library-header';
import { LoginCard } from '@/components/login-card';
import { SiteDetail } from '@/components/site-detail';
import { SiteSection } from '@/components/site-list';
import { useLocalSites, useSyncSitesWithHost, useWpcomSites } from '@/data/queries/use-library';
import { useApplyHostContext } from '@/hooks/use-apply-host-context';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useHostState } from '@/hooks/use-host-state';
import { canMessage, isPage } from '@/lib/host-capabilities';
import { entryKey, searchEntries } from '@/lib/sites';
import type { SiteEntry } from '@/data/types';

const noMatches = <EmptyState title="No matching sites" copy="Try another name." />;

// The library: the user's sites, or one site's page.
export function Library() {
	const { status, context, capabilities } = useHostState();
	const local = useLocalSites();
	const wpcom = useWpcomSites();
	const [ query, setQuery ] = useState( '' );
	const [ openKey, setOpenKey ] = useState< string | null >( null );
	const resizeRef = useAutoResize();
	useApplyHostContext();
	useSyncSitesWithHost();

	const localSites = local.data ?? [];
	const wpcomSites = wpcom.data?.sites ?? [];
	const all = searchEntries( localSites, wpcomSites, '' );
	const open = [ ...all.local, ...all.wpcom ].find( ( entry ) => entryKey( entry ) === openKey );
	const groups = searchEntries( localSites, wpcomSites, query );
	const failed = status === 'failed';
	const loading = ! failed && local.isPending;
	const failure = failed
		? 'The host did not start the library. Reopen it.'
		: local.error?.message || null;
	const wpcomError = wpcom.error?.message || wpcom.data?.error;
	const searching = query.trim() !== '';
	const openEntry = ( entry: SiteEntry ) => {
		setOpenKey( entryKey( entry ) );
		window.scrollTo( 0, 0 );
	};

	return (
		<main ref={ resizeRef } aria-busy={ loading }>
			<div className={ isPage( context ) ? 'library page' : 'library' }>
				{ open ? (
					<button
						type="button"
						className="back"
						data-kind="quiet"
						data-size="sm"
						onClick={ () => setOpenKey( null ) }
					>
						← All sites
					</button>
				) : (
					<LibraryHeader query={ query } onQueryChange={ setQuery } />
				) }
				{ failure && <FailureNotice message={ failure } onRetry={ () => void local.refetch() } /> }
				{ loading && (
					<p className="note" role="status">
						Loading your sites…
					</p>
				) }
				{ open && <SiteDetail key={ entryKey( open ) } entry={ open } /> }
				{ ! open && local.data && (
					<div className="lists">
						<SiteSection
							title="On this computer"
							entries={ groups.local }
							withNewSite={ ! searching && canMessage( capabilities ) }
							onOpen={ openEntry }
							empty={
								searching ? (
									noMatches
								) : (
									<EmptyState
										title="No local sites yet"
										copy="Studio runs WordPress sites on this computer."
									/>
								)
							}
						/>
						<SiteSection
							title="On WordPress.com"
							entries={ groups.wpcom }
							onOpen={ openEntry }
							empty={
								wpcom.isPending ? (
									<p className="note" role="status">
										Loading your WordPress.com sites…
									</p>
								) : wpcomError ? (
									<EmptyState title="Your WordPress.com sites could not load" copy={ wpcomError } />
								) : ! wpcom.data?.signedIn ? (
									<LoginCard />
								) : searching ? (
									noMatches
								) : (
									<EmptyState
										title="No WordPress.com sites yet"
										copy="Publish a Studio site to WordPress.com to see it here."
									/>
								)
							}
						/>
					</div>
				) }
			</div>
		</main>
	);
}
