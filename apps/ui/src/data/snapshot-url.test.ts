import { describe, expect, it } from 'vitest';
import { getSnapshotOpenUrl, getSnapshotUrl } from './snapshot-url';
import type { Snapshot } from '@/data/core';

const preview: Snapshot = {
	url: 'humble-duck-engineer.wpcomstaging.com',
	atomicSiteId: 258287853,
	localSiteId: 'local',
	date: 0,
	shareUrl: 'https://humble-duck-engineer.wpcomstaging.com/?share=abc',
};

describe( 'getSnapshotOpenUrl', () => {
	it( 'signs the owner in to a WordPress.com preview on the way to its homepage', () => {
		expect( getSnapshotOpenUrl( preview ) ).toBe(
			'https://humble-duck-engineer.wpcomstaging.com/wp-login.php?redirect_to=https%3A%2F%2Fhumble-duck-engineer.wpcomstaging.com%2F'
		);
	} );

	it( 'leaves the preview link for sharing', () => {
		expect( getSnapshotUrl( preview ) ).toBe( preview.shareUrl );
	} );

	it( 'opens a public Jurassic Ninja preview as it is', () => {
		const jn = { ...preview, url: 'chubes4-guaic-studio.wp.build', shareUrl: undefined };
		expect( getSnapshotOpenUrl( jn ) ).toBe( 'https://chubes4-guaic-studio.wp.build' );
	} );
} );
