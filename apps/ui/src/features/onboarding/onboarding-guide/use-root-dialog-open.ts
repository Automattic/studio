import { useSearch } from '@tanstack/react-router';
import { useUsageNoticePending } from '@/data/queries/use-usage-notice';

/**
 * Whether Welcome, Settings, Add site or the usage notice is open, or the notice may still open.
 * The others open from the root search, deep links included, and a guide waits for them to close
 * rather than covering them.
 */
export function useRootDialogOpen(): boolean {
	const { welcome, settings, addSite } = useSearch( { strict: false } ) as {
		welcome?: true;
		settings?: string;
		addSite?: string;
	};
	const usageNotice = useUsageNoticePending();
	return (
		!! ( welcome || settings || addSite ) || usageNotice.isPending || usageNotice.data === true
	);
}
