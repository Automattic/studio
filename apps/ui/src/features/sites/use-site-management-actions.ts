import { __ } from '@wordpress/i18n';
import {
	EXPORT_DATABASE_MUTATION_KEY,
	EXPORT_FULL_SITE_MUTATION_KEY,
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteBusy,
	useIsSiteMutating,
} from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { DatabaseIcon, DuplicateIcon, ExportSiteIcon, ImportIcon, TrashIcon } from '@/lib/icons';
import type { SiteDetails } from '@/data/core';
import type { ComponentType } from 'react';

export type SiteManagementActionId = 'duplicate' | 'import' | 'export' | 'export-db' | 'delete';

export interface SiteManagementAction {
	id: SiteManagementActionId;
	icon: ComponentType;
	label: string;
	disabled: boolean;
	destructive: boolean;
	run: () => void;
}

/**
 * The canonical "manage this site" actions — Duplicate, Import, Export entire site,
 * Export database, Delete — shared by every surface that offers them, so labels, icons,
 * order, and disabled logic don't drift apart between surfaces.
 *
 * Import and Delete open UI the caller owns (a file picker with an overwrite
 * confirmation, a delete confirmation): pass `onImport` and `onDelete`.
 */
export function useSiteManagementActions(
	site: SiteDetails,
	{ onDelete, onImport }: { onDelete: () => void; onImport: () => void }
): SiteManagementAction[] {
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();

	// Read from the mutation cache rather than each mutation's own `isPending`,
	// so progress survives navigating away and back — the observers these hooks
	// create die with the screen, the cache entries don't.
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

	// Covers the backup upload, before the CLI takes the site.
	const activity = useSiteSyncActivity( site.id );
	const isImporting = activity?.kind === 'pending' && activity.direction === 'import';
	const isWriting = isBusy || isImporting;

	return [
		{
			id: 'duplicate',
			icon: DuplicateIcon,
			label: __( 'Duplicate' ),
			disabled: isWriting,
			destructive: false,
			run: () => copySite.mutate( site.id ),
		},
		{
			id: 'import',
			icon: ImportIcon,
			label: __( 'Import' ),
			disabled: isWriting || isExporting,
			destructive: false,
			run: onImport,
		},
		{
			id: 'export',
			icon: ExportSiteIcon,
			label: __( 'Export entire site' ),
			disabled: isWriting || isExporting,
			destructive: false,
			run: () => exportFullSite.mutate( site.id ),
		},
		{
			id: 'export-db',
			icon: DatabaseIcon,
			label: __( 'Export database' ),
			disabled: isWriting || isExporting,
			destructive: false,
			run: () => exportDatabase.mutate( site.id ),
		},
		{
			id: 'delete',
			icon: TrashIcon,
			label: __( 'Delete' ),
			// Also blocked mid-export: the archive is still being read off disk.
			disabled: isWriting || isExporting,
			destructive: true,
			run: onDelete,
		},
	];
}
