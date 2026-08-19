import { describe, expect, it } from 'vitest';
import { groupDesignArtifacts } from './group-artifacts';
import type { DesignArtifact } from '@studio/common/design-project';

function artifact( id: string, revision: number, label: string, parentArtifactId?: string ) {
	return {
		id,
		revision,
		kind: 'direction',
		label,
		rationale: '',
		path: `artifacts/${ id }/index.html`,
		digest: `sha256:${ String( revision ).repeat( 64 ).slice( 0, 64 ) }`,
		createdAt: `2026-08-18T12:0${ revision }:00.000Z`,
		parentArtifactId,
	} satisfies DesignArtifact;
}

describe( 'groupDesignArtifacts', () => {
	it( 'groups an explicit artifact revision under its original direction', () => {
		const groups = groupDesignArtifacts( [
			artifact( 'original', 1, 'VHS Terminal' ),
			artifact( 'other', 2, 'Punk Zine' ),
			artifact( 'revision', 3, 'VHS Terminal', 'original' ),
		] );

		expect( groups.map( ( group ) => group.label ) ).toEqual( [ 'VHS Terminal', 'Punk Zine' ] );
		expect( groups[ 0 ].artifacts.map( ( item ) => item.id ) ).toEqual( [
			'original',
			'revision',
		] );
	} );

	it( 'groups legacy v2 labels that predate artifact lineage', () => {
		const groups = groupDesignArtifacts( [
			artifact( 'original', 1, 'VHS Terminal' ),
			artifact( 'revision', 2, 'VHS Terminal v2' ),
		] );

		expect( groups ).toHaveLength( 1 );
		expect( groups[ 0 ].label ).toBe( 'VHS Terminal' );
		expect( groups[ 0 ].artifacts ).toHaveLength( 2 );
	} );
} );
