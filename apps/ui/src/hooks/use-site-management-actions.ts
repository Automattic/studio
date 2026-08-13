import { __ } from '@wordpress/i18n';
import { copy, download, grid, trash, upload } from '@wordpress/icons';
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
import { useSiteSyncActivity } from '@/data/sync-activity';
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
 * matching action's `run` calls them. Import is omitted entirely on surfaces
 * that don't pass `onImport`, since they have nowhere to host that UI.
 */
export function useSiteManagementActions(
	site: SiteDetails,
	{ onDelete, onImport }: { onDelete: () => void; onImport?: () => void }
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

	// Every one of these reads or rewrites the site tree, so none should run
	// while an operation holds the site — including work started by the agent or
	// another window. Delete would be refused by the CLI; the rest are disabled
	// here because reading a site mid-delete or mid-restart is not worth doing.
	const isBusy = useIsSiteBusy( site );

	// Import is deliberately not a `SITE_OPERATIONS` kind — a sync can hold a
	// site for tens of minutes, which costs more than it protects — so the CLI
	// won't refuse these. Guard the write window here instead: an import
	// replaces the files and database the others read from.
	const activity = useSiteSyncActivity( site.id );
	const isImporting = activity?.kind === 'pending' && activity.direction === 'import';
	const isWriting = isBusy || isImporting;

	return [
		{
			id: 'duplicate',
			icon: copy,
			label: __( 'Duplicate' ),
			loading: isDuplicating,
			loadingAnnouncement: __( 'Duplicating site' ),
			disabled: isWriting,
			destructive: false,
			run: () => copySite.mutate( site.id ),
		},
		...( onImport
			? [
					{
						id: 'import' as const,
						icon: upload,
						label: __( 'Import' ),
						loading: isImporting,
						loadingAnnouncement: __( 'Importing site' ),
						disabled: isWriting || isExporting,
						destructive: false,
						run: onImport,
					},
			  ]
			: [] ),
		{
			id: 'export',
			icon: download,
			label: __( 'Export entire site' ),
			loading: isExportingFullSite,
			loadingAnnouncement: __( 'Exporting site' ),
			disabled: isWriting || isExporting,
			destructive: false,
			run: () => exportFullSite.mutate( site.id ),
		},
		{
			id: 'export-db',
			icon: grid,
			label: __( 'Export database' ),
			loading: isExportingDatabase,
			loadingAnnouncement: __( 'Exporting database' ),
			disabled: isWriting || isExporting,
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
			disabled: isWriting || isExporting,
			destructive: true,
			run: onDelete,
		},
	];
}
