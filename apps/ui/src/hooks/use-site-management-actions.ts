import { __ } from '@wordpress/i18n';
import { copy, download, grid, trash } from '@wordpress/icons';
import { useCopySite, useExportDatabase, useExportFullSite } from '@/data/queries/use-sites';
import type { SiteDetails } from '@/data/core';
import type { ReactElement, SVGProps } from 'react';

export type SiteManagementActionId = 'duplicate' | 'export' | 'export-db' | 'delete';

export interface SiteManagementAction {
	id: SiteManagementActionId;
	// Matches the element type `Icon` accepts, so callers render via
	// `<Icon icon={ action.icon } />` without widening casts. Surfaces that
	// show plain-text rows (the sidebar context menu) can ignore it.
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
 * Delete — shared by every surface that offers them (the sidebar context
 * menu, the preview's Open in… menu, and the site overview). Keeping the
 * labels, icons, order, and disabled logic in one place stops the three
 * surfaces from drifting apart.
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

	// Full-site and database exports share one backend queue, so either
	// running disables both.
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;

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
			id: 'export',
			icon: download,
			label: __( 'Export' ),
			loading: exportFullSite.isPending,
			loadingAnnouncement: __( 'Exporting site' ),
			disabled: isExporting,
			destructive: false,
			run: () => exportFullSite.mutate( site.id ),
		},
		{
			id: 'export-db',
			icon: grid,
			label: __( 'Export DB' ),
			loading: exportDatabase.isPending,
			loadingAnnouncement: __( 'Exporting database' ),
			disabled: isExporting,
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
