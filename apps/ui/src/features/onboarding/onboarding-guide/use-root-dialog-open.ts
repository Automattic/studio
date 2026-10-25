import { useSearch } from '@tanstack/react-router';

/**
 * Whether Welcome, Settings or Add site is open. They open from the root search,
 * deep links included, and a guide waits for them to close rather than covering
 * them.
 */
export function useRootDialogOpen(): boolean {
	const { welcome, settings, addSite } = useSearch( { strict: false } ) as {
		welcome?: true;
		settings?: string;
		addSite?: string;
	};
	return !! ( welcome || settings || addSite );
}
