import { createWpcomSyncDriver } from './wpcom-sync';
import type { HostManifest } from '../manifest';
import type { RemoteHost } from '@studio/agent/node';

export type HostDriver = Pick< RemoteHost, 'targets' | 'push' | 'pull' > & {
	sites: Pick< NonNullable< RemoteHost[ 'sites' ] >, 'list' >;
};

export const DRIVERS: Record< string, ( manifest: HostManifest ) => HostDriver > = {
	'wpcom-sync': createWpcomSyncDriver,
};
