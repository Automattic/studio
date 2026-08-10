import { __ } from '@wordpress/i18n';
import { copy, download, grid, trash, upload } from '@wordpress/icons';
import { useCopySite, useExportDatabase, useExportFullSite } from '@/data/queries/use-sites';
import type { SiteDetails } from '@/data/core';
import type { ReactElement, SVGProps } from 'react';

export type SiteManagementActionId = 'duplicate' | 'import' | 'export' | 'export-db' | 'delete';

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
 * The canonical "manage this site" actions — Duplicate, Import, Export entire site,
 * Export database, Delete — shared by every surface that offers them, so labels, icons,
 * order, and disabled logic don't drift apart between surfaces.
 *
 * Import and Delete both need surface-owned UI (a file picker plus an overwrite
 * confirmation, and a confirmation dialog whose "deleted" navigation differs per
 * surface), so this hook doesn't own either: pass `onImport` / `onDelete` and the
 * matching action's `run` calls them. `isImporting` comes back in from the surface
 * running the import so exports and imports can block each other.
 */
export function useSiteManagementActions(
	site: SiteDetails,
	{
		onDelete,
		onImport,
		isImporting,
	}: { onDelete: () => void; onImport: () => void; isImporting: boolean }
): SiteManagementAction[] {
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();

	// Full-site and database exports share one backend queue, so either
	// running disables both. An import rewrites the files being read, so it
	// blocks exports too — and vice versa.
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;
	const isBusy = isExporting || isImporting;

	return [
		{
			id: 'duplicate',
			icon: copy,
			label: __( 'Duplicate' ),
			loading: copySite.isPending,
			loadingAnnouncement: __( 'Duplicating site' ),
			disabled: copySite.isPending,
			destructive: false,
			run: () => copySite.mutate( site.id ),
		},
		{
			id: 'import',
			icon: upload,
			label: __( 'Import' ),
			loading: isImporting,
			loadingAnnouncement: __( 'Importing site' ),
			disabled: isBusy,
			destructive: false,
			run: onImport,
		},
		{
			id: 'export',
			icon: download,
			label: __( 'Export entire site' ),
			loading: exportFullSite.isPending,
			loadingAnnouncement: __( 'Exporting site' ),
			disabled: isBusy,
			destructive: false,
			run: () => exportFullSite.mutate( site.id ),
		},
		{
			id: 'export-db',
			icon: grid,
			label: __( 'Export database' ),
			loading: exportDatabase.isPending,
			loadingAnnouncement: __( 'Exporting database' ),
			disabled: isBusy,
			destructive: false,
			run: () => exportDatabase.mutate( site.id ),
		},
		{
			id: 'delete',
			icon: trash,
			label: __( 'Delete' ),
			loading: false,
			loadingAnnouncement: '',
			disabled: false,
			destructive: true,
			run: onDelete,
		},
	];
}
