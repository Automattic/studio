import { describe, expect, it } from 'vitest';
import { websiteIssue } from './options';
import type { TransferDirection } from './options';
import type { SyncSite } from '@/data/core';

const site: SyncSite = {
	id: 42,
	localSiteId: 'local',
	name: 'Hosted site',
	url: 'https://example.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPushTimestamp: null,
	lastPullTimestamp: null,
};

describe( 'websiteIssue', () => {
	it.each< TransferDirection >( [ 'pull', 'push' ] )(
		'blocks %s for a site that needs an upgrade',
		( direction ) => {
			expect( websiteIssue( { ...site, syncSupport: 'needs-upgrade' }, direction ) ).toBe(
				'This website needs a hosting plan that supports publishing from WordPress Studio.'
			);
		}
	);
} );
