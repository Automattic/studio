import { __ } from '@wordpress/i18n';
import { copy, download, grid, trash } from '@wordpress/icons';
import {
	COPY_SITE_MUTATION_KEY,
	EXPORT_DATABASE_MUTATION_KEY,
	EXPORT_FULL_SITE_MUTATION_KEY,
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteBusy,
	useIsSiteMutating,
} from '@/data/queries/use-sites';
import type { SiteDetails } from '@/data/core';
import type { ReactElement, SVGProps } from 'react';

export type SiteManagementActionId = 'duplicate' | 'export' | 'export-db' | 'delete';

export interface SiteManagementAction {
	id: SiteManagementActionId;
	// Matches the element type `Icon` accepts, so callers render via
	// `<Icon icon={ action.icon } />` without widening casts. Surfaces that
	// show plain-text rows can ignore it.
	icon: ReactElement< SVGProps< SVGSVGElement > >;
	label: string;
	// True while this action's own work is in flight (drives spinners on
	// surfaces that show them).
	loading: boolean;
	// Assistive-tech announcement for the loading state.
	loadingAnnouncement: string;
	disabled: boolean;
	destructive: boolean;
	run: () => void;
}

/**
 * The canonical "manage this site" actions — Duplicate, Export, Export DB,
 * Delete — shared by every surface that offers them, so labels, icons,
 * order, and disabled logic don't drift apart between surfaces.
 *
 * Delete needs a confirmation dialog whose "deleted" navigation differs per
 * surface, so this hook doesn't own the dialog: pass `onDelete` to open your
 * own `DeleteSiteDialog` and the Delete action's `run` calls it.
 */
export function useSiteManagementActions(
	site: SiteDetails,
	{ onDelete }: { onDelete: () => void }
): SiteManagementAction[] {
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();

	// Read from the mutation cache rather than each mutation's own `isPending`,
	// so progress survives navigating away and back — the observers these hooks
	// create die with the screen, the cache entries don't.
	const isDuplicating = useIsSiteMutating( site.id, COPY_SITE_MUTATION_KEY );
	const isExportingFullSite = useIsSiteMutating( site.id, EXPORT_FULL_SITE_MUTATION_KEY );
	const isExportingDatabase = useIsSiteMutating( site.id, EXPORT_DATABASE_MUTATION_KEY );

	// Full-site and database exports share one backend queue, so either
	// running disables both.
	const isExporting = isExportingFullSite || isExportingDatabase;

	// Every one of these reads or rewrites the site tree, so none can run while
	// the CLI holds the site — including for work started by the agent or
	// another window. The CLI would refuse them anyway; disabling here means the
	// user sees that instead of clicking into a dead control.
	const isBusy = useIsSiteBusy( site );

	return [
		{
			id: 'duplicate',
			icon: copy,
			label: __( 'Duplicate' ),
			loading: isDuplicating,
			loadingAnnouncement: __( 'Duplicating site' ),
			disabled: isBusy,
			destructive: false,
			run: () => copySite.mutate( site.id ),
		},
		{
			id: 'export',
			icon: download,
			label: __( 'Export' ),
			loading: isExportingFullSite,
			loadingAnnouncement: __( 'Exporting site' ),
			disabled: isBusy || isExporting,
			destructive: false,
			run: () => exportFullSite.mutate( site.id ),
		},
		{
			id: 'export-db',
			icon: grid,
			label: __( 'Export DB' ),
			loading: isExportingDatabase,
			loadingAnnouncement: __( 'Exporting database' ),
			disabled: isBusy || isExporting,
			destructive: false,
			run: () => exportDatabase.mutate( site.id ),
		},
		{
			id: 'delete',
			icon: trash,
			label: __( 'Delete' ),
			loading: false,
			loadingAnnouncement: '',
			// Also blocked mid-export: the archive is still being read off disk.
			disabled: isBusy || isExporting,
			destructive: true,
			run: onDelete,
		},
	];
}
