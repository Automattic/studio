import { addWpVersionToList } from './add-wp-version-to-list';

describe( 'addWpVersionToList', () => {
	it( 'should add version to empty list', () => {
		const options: Array< { label: string; value: string } > = [];
		const result = addWpVersionToList( { label: '6.4.2', value: '6.4.2' }, options );
		expect( result ).toEqual( [ { label: '6.4.2', value: '6.4.2' } ] );
	} );

	it( 'should add version at the top when it is newer than all existing versions', () => {
		const options = [
			{ label: '6.4.1', value: '6.4.1' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: '6.4.3', value: '6.4.3' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.3', value: '6.4.3' },
			{ label: '6.4.1', value: '6.4.1' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );

	it( 'should add version at the end when it is older than all existing versions', () => {
		const options = [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1', value: '6.4.1' },
		];
		const result = addWpVersionToList( { label: '6.4.0', value: '6.4.0' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1', value: '6.4.1' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );

	it( 'should add version in the middle when it is between existing versions', () => {
		const options = [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: '6.4.1', value: '6.4.1' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1', value: '6.4.1' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );

	it( 'should handle non-semver versions by adding them at the end', () => {
		const options = [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: 'nightly', value: 'nightly' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.0', value: '6.4.0' },
			{ label: 'nightly', value: 'nightly' },
		] );
	} );

	it( 'should handle mixed semver and non-semver versions', () => {
		const options = [
			{ label: 'nightly', value: 'nightly' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: '6.4.1', value: '6.4.1' }, options );
		expect( result ).toEqual( [
			{ label: 'nightly', value: 'nightly' },
			{ label: '6.4.1', value: '6.4.1' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );

	it( 'should handle beta versions correctly', () => {
		const options = [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: '6.4.1-beta2', value: '6.4.1-beta2' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1-beta2', value: '6.4.1-beta2' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );

	it( 'should handle RC versions correctly', () => {
		const options = [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: '6.4.1-RC1', value: '6.4.1-RC1' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1-RC1', value: '6.4.1-RC1' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );

	it( 'should handle multiple pre-release versions', () => {
		const options = [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1-beta2', value: '6.4.1-beta2' },
			{ label: '6.4.0', value: '6.4.0' },
		];
		const result = addWpVersionToList( { label: '6.4.1-beta1', value: '6.4.1-beta1' }, options );
		expect( result ).toEqual( [
			{ label: '6.4.2', value: '6.4.2' },
			{ label: '6.4.1-beta2', value: '6.4.1-beta2' },
			{ label: '6.4.1-beta1', value: '6.4.1-beta1' },
			{ label: '6.4.0', value: '6.4.0' },
		] );
	} );
} );
