import { IpcMainInvokeEvent } from 'electron';
import {
	deleteAllPreviewSites,
	fetchSnapshots as fetchSnapshotsFromCli,
	deletePreviewSite as deletePreviewSiteViaCli,
	publishPreviewSite as publishPreviewSiteViaCli,
	renamePreviewSite as renamePreviewSiteViaCli,
} from '@studio/common/sites/snapshots';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type { Snapshot } from '@studio/common/types/snapshot';

export async function fetchSnapshots(): Promise< Snapshot[] > {
	return fetchSnapshotsFromCli( executeCliCommand );
}

// Resolves with the preview's URL once it's published. Progress reaches the UI
// as sync activity.
export async function publishPreviewSite(
	_event: IpcMainInvokeEvent,
	siteFolder: string,
	hostname?: string,
	name?: string
): Promise< { url: string } > {
	return publishPreviewSiteViaCli( executeCliCommand, siteFolder, hostname, name );
}

export async function deletePreviewSite( _event: IpcMainInvokeEvent, hostname: string ) {
	return deletePreviewSiteViaCli( executeCliCommand, hostname );
}

export async function renamePreviewSite(
	_event: IpcMainInvokeEvent,
	hostname: string,
	name: string
) {
	return renamePreviewSiteViaCli( executeCliCommand, hostname, name );
}

export async function deleteAllSnapshots() {
	return deleteAllPreviewSites( executeCliCommand );
}
