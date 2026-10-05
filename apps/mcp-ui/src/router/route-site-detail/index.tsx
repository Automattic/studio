import { Navigate, createRoute } from '@tanstack/react-router';
import { SiteDetail } from '@/components/site-detail';
import { useLibrary } from '@/data/queries/use-library';
import { findEntry } from '@/lib/sites';
import { rootRoute } from '../layout-root';
import type { SiteKind } from '@/data/core';

function SiteDetailRoute( { kind, id }: { kind: SiteKind; id: string } ) {
	const { data, isPending, isError } = useLibrary();
	const entry = findEntry( data, kind, id );
	if ( entry ) {
		return <SiteDetail key={ entry.key } entry={ entry } />;
	}
	return isPending && ! isError ? null : <Navigate to="/" replace />;
}

export const localSiteRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/sites/local/$id',
	component: function LocalSiteRoute() {
		return <SiteDetailRoute kind="local" id={ localSiteRoute.useParams().id } />;
	},
} );

export const wpcomSiteRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/sites/wpcom/$id',
	component: function WpcomSiteRoute() {
		return <SiteDetailRoute kind="wpcom" id={ wpcomSiteRoute.useParams().id } />;
	},
} );
