export {
	syncOptionSchema,
	syncSiteSchema,
	syncSupportValues,
	type PullSyncOptions,
	type PushSyncOptions,
	type SyncOption,
	type SyncSite,
	type SyncSupport,
} from '@studio/providers/wpcom';

// Phases a push moves through: Studio builds the archive, or renders a static copy from the
// running site, then the provider takes over (`PushStatus`).
export const PUSH_PHASES = [
	'creatingBackup',
	'startingSite',
	'generatingStaticSite',
	'stoppingSite',
	'uploading',
	'waitingForRemote',
	'creatingRemoteBackup',
	'applyingChanges',
	'finishing',
	'launching',
] as const;
export type PushPhase = ( typeof PUSH_PHASES )[ number ];
