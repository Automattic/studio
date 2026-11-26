import { useSearch } from '@tanstack/react-router';
import { useWelcomeOpen } from '@/data/queries/use-onboarding-completed';

/**
 * Whether Welcome, Settings or Add site is open. Settings and Add site open from
 * the root search, deep links included, and a guide waits for them to close
 * rather than covering them.
 */
export function useRootDialogOpen(): boolean {
	const { settings, addSite } = useSearch( { strict: false } ) as {
		settings?: string;
		addSite?: string;
	};
	return !! ( useWelcomeOpen() || settings || addSite );
}
