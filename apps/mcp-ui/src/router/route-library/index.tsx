import { createRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/empty-state';
import { LoginCard } from '@/components/login-card';
import { SiteSection } from '@/components/site-list';
import { EMPTY_LIBRARY, useLibrary } from '@/data/queries/use-library';
import { useHostState } from '@/hooks/use-host-state';
import { useSearchQuery } from '@/hooks/use-search-query';
import { canMessage } from '@/lib/host-capabilities';
import { searchEntries } from '@/lib/sites';
import { rootRoute } from '../layout-root';

function LibraryRoute() {
	const { data = EMPTY_LIBRARY, isPending, isError } = useLibrary();
	const { capabilities } = useHostState();
	const [ query ] = useSearchQuery();
	if ( isPending && ! isError ) {
		return null;
	}
	const searching = query.trim() !== '';
	const groups = searchEntries( data, query );
	const wpcom = data.wpcom;
	return (
		<div className="lists">
			<SiteSection
				title="On this computer"
				entries={ groups.local }
				withNewSite={ ! searching && canMessage( capabilities ) }
				empty={
					searching ? (
						<EmptyState title="No matching local sites" copy="Try another name." />
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
				empty={
					! wpcom.signedIn ? (
						<LoginCard />
					) : wpcom.error ? (
						<EmptyState title="Your WordPress.com sites could not load" copy={ wpcom.error } />
					) : searching ? (
						<EmptyState title="No matching WordPress.com sites" copy="Try another name." />
					) : (
						<EmptyState
							title="No WordPress.com sites yet"
							copy="Publish a Studio site to WordPress.com to see it here."
						/>
					)
				}
			/>
		</div>
	);
}

export const libraryRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/',
	component: LibraryRoute,
} );
