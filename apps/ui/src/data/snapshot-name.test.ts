import { expect, it } from 'vitest';
import { getSnapshotName } from './snapshot-name';
import type { Snapshot } from './core';

const preview: Snapshot = {
	atomicSiteId: 1,
	localSiteId: 'local',
	userId: 1,
	url: 'preview.example.com',
	date: 1,
};

it( 'uses a saved name and keeps saved preview numbers when other previews are removed', () => {
	expect( getSnapshotName( { ...preview, name: 'Homepage refresh', sequence: 7 } ) ).toBe(
		'Homepage refresh'
	);
	expect( getSnapshotName( { ...preview, sequence: 7 } ) ).toBe( 'Preview 7' );
} );

it( 'numbers legacy previews chronologically within their site and account', () => {
	const newer = { ...preview, atomicSiteId: 2, date: 2 };
	const snapshots = [
		newer,
		{ ...preview, atomicSiteId: 3, localSiteId: 'other-site' },
		{ ...preview, atomicSiteId: 4, userId: 2 },
		preview,
	];
	expect( getSnapshotName( newer, snapshots ) ).toBe( 'Preview 2' );
	expect( getSnapshotName( preview, snapshots ) ).toBe( 'Preview 1' );
	expect( snapshots[ 0 ] ).toBe( newer );
} );
