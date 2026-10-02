import { Outlet, createRootRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { FailureNotice } from '@/components/failure-notice';
import { LibraryHeader } from '@/components/library-header';
import { useLibrary } from '@/data/queries/use-library';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useDeepLink } from '@/hooks/use-deep-link';
import { useHostState } from '@/hooks/use-host-state';
import { useLiveTools } from '@/hooks/use-live-tools';
import { useSearchQuery } from '@/hooks/use-search-query';
import { isPage } from '@/lib/host-capabilities';

function RootLayout() {
	const { status, context } = useHostState();
	const library = useLibrary();
	const [ query, setQuery ] = useSearchQuery();
	const onSitePage = useRouterState( { select: ( state ) => state.location.pathname !== '/' } );
	const navigate = useNavigate();
	const resizeRef = useAutoResize();
	useLiveTools();
	useDeepLink();

	const failed = status === 'failed';
	const loading = ! failed && library.isPending && ! library.isError;
	const failure = failed
		? 'The host did not start the library. Reopen it.'
		: library.error?.message || null;

	return (
		<main ref={ resizeRef } aria-busy={ loading }>
			<div className={ isPage( context ) ? 'library page' : 'library' }>
				{ onSitePage ? (
					<button
						type="button"
						className="back"
						data-kind="quiet"
						data-size="sm"
						onClick={ () => void navigate( { to: '/' } ) }
					>
						← All sites
					</button>
				) : (
					<LibraryHeader query={ query } onQueryChange={ setQuery } />
				) }
				{ failure && (
					<FailureNotice message={ failure } onRetry={ () => void library.refetch() } />
				) }
				{ loading && (
					<p className="note" role="status">
						Loading your sites…
					</p>
				) }
				<Outlet />
			</div>
		</main>
	);
}

export const rootRoute = createRootRoute( { component: RootLayout } );
