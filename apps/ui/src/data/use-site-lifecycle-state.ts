import { useIsSiteBusy, useSiteOperation } from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import type { SiteDetails } from '@/data/core';

export function useSiteLifecycleState(
	site: SiteDetails,
	isStarting: boolean,
	isStopping: boolean
) {
	const siteBusy = useIsSiteBusy( site );
	const activity = useSiteSyncActivity( site.id );
	const isSyncPending = activity?.kind === 'pending' && activity.direction !== 'preview';
	const operation = useSiteOperation( site );
	const starting = operation === 'start' || ( isStarting && ! operation );
	const stoppingStart = starting && ( isStopping || site.operation?.cancelRequested === true );
	const canStopStart =
		starting &&
		! stoppingStart &&
		! isSyncPending &&
		( isStarting || site.operation?.cancelRequested === false );
	const visuallyStopped = ( ! stoppingStart && isStopping ) || operation === 'stop';
	return {
		activity,
		isSyncPending,
		operation,
		starting,
		stoppingStart,
		canStopStart,
		visuallyStopped,
		visualBusy: isSyncPending || ( siteBusy && ! visuallyStopped ),
		visualRunning: !! site.running && ! visuallyStopped,
		disabled: ( siteBusy || isSyncPending ) && ! canStopStart,
	};
}
