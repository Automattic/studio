import { describe, expect, it } from 'vitest';
import { getSnapshotAdminUrl, getSnapshotUrl } from './snapshot-url';
import type { Snapshot } from '@/data/core';

const preview: Snapshot = {
	url: 'humble-duck-engineer.wpcomstaging.com',
	atomicSiteId: 258287853,
	localSiteId: 'local',
	date: 0,
	shareUrl: 'https://humble-duck-engineer.wpcomstaging.com/?share=abc',
};

describe( 'getSnapshotAdminUrl', () => {
	it( 'signs the owner in to a WordPress.com preview on the way to its WP Admin', () => {
		expect( getSnapshotAdminUrl( preview ) ).toBe(
			'https://humble-duck-engineer.wpcomstaging.com/wp-login.php?redirect_to=https%3A%2F%2Fhumble-duck-engineer.wpcomstaging.com%2Fwp-admin%2F'
		);
	} );

	it( 'opens the preview itself through its preview link', () => {
		expect( getSnapshotUrl( preview ) ).toBe( preview.shareUrl );
	} );

	it( 'opens a public Jurassic Ninja preview as it is, with no WP Admin to sign in to', () => {
		const jn = { ...preview, url: 'chubes4-guaic-studio.wp.build', shareUrl: undefined };
		expect( getSnapshotUrl( jn ) ).toBe( 'https://chubes4-guaic-studio.wp.build' );
		expect( getSnapshotAdminUrl( jn ) ).toBeUndefined();
	} );
} );
