import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FailureNotice } from '@/components/failure-notice';
import { LibraryHeader } from '@/components/library-header';
import { SiteDetail } from '@/components/site-detail';
import { SiteSection } from '@/components/site-list';
import { useLocalSites, useSyncSitesWithHost } from '@/data/queries/use-library';
import { useApplyHostContext } from '@/hooks/use-apply-host-context';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useHostState } from '@/hooks/use-host-state';
import { canMessage, isPage } from '@/lib/host-capabilities';
import { searchSites } from '@/lib/sites';

// The library: the user's sites, or one site's page.
export function Library() {
	const { status, context, capabilities } = useHostState();
	const sites = useLocalSites();
	const [ query, setQuery ] = useState( '' );
	const [ openId, setOpenId ] = useState< string | null >( null );
	const resizeRef = useAutoResize();
	useApplyHostContext();
	useSyncSitesWithHost();
	const open = sites.data?.find( ( site ) => site.id === openId );

	const failed = status === 'failed';
	const loading = ! failed && sites.isPending;
	const failure = failed
		? 'The host did not start the library. Reopen it.'
		: sites.error?.message || null;
	const searching = query.trim() !== '';

	return (
		<main ref={ resizeRef } aria-busy={ loading }>
			<div className={ isPage( context ) ? 'library page' : 'library' }>
				{ open ? (
					<button
						type="button"
						className="back"
						data-kind="quiet"
						data-size="sm"
						onClick={ () => setOpenId( null ) }
					>
						← All sites
					</button>
				) : (
					<LibraryHeader query={ query } onQueryChange={ setQuery } />
				) }
				{ failure && <FailureNotice message={ failure } onRetry={ () => void sites.refetch() } /> }
				{ loading && (
					<p className="note" role="status">
						Loading your sites…
					</p>
				) }
				{ open ? (
					<SiteDetail key={ open.id } site={ open } />
				) : (
					sites.data && (
						<SiteSection
							title="On this computer"
							sites={ searchSites( sites.data, query ) }
							withNewSite={ ! searching && canMessage( capabilities ) }
							onOpen={ ( site ) => {
								setOpenId( site.id );
								window.scrollTo( 0, 0 );
							} }
							empty={
								searching ? (
									<EmptyState title="No matching sites" copy="Try another name." />
								) : (
									<EmptyState
										title="No local sites yet"
										copy="Studio runs WordPress sites on this computer."
									/>
								)
							}
						/>
					)
				) }
			</div>
		</main>
	);
}
