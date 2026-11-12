import { describe, expect, it } from 'vitest';
import { customizeBlueprint, inspectBlueprint } from './details';
import type { Blueprint } from './validate';

const blueprint: Blueprint = {
	meta: { title: 'Fern & Fig', description: 'A florist', author: 'Studio' },
	preferredVersions: { php: '8.3', wp: '6.8' },
	siteOptions: { blogname: 'Shorthand title' },
	login: { username: 'editor', password: 'secret' },
	steps: [
		{ step: 'login', username: 'admin' },
		{ step: 'defineSiteUrl', siteUrl: 'https://fern.local' },
		{ step: 'setSiteOptions', options: { blogname: 'Fern & Fig' } },
		{ step: 'setSiteOptions', options: { blogdescription: 'Flowers' } },
		{ step: 'enableMultisite' },
	],
};

describe( 'inspectBlueprint', () => {
	it( 'reports what the Blueprint asks for', () => {
		expect( inspectBlueprint( blueprint ) ).toEqual( {
			title: 'Fern & Fig',
			description: 'A florist',
			phpVersion: '8.3',
			wpVersion: '6.8',
			siteTitle: 'Fern & Fig',
			siteUrl: 'https://fern.local',
			login: { username: 'editor', password: 'secret' },
			multisite: true,
		} );
	} );

	it( 'reports only multisite for an empty Blueprint', () => {
		expect( inspectBlueprint( {} ) ).toEqual( { multisite: false } );
	} );
} );

describe( 'customizeBlueprint', () => {
	it( 'changes the details the Blueprint sets, without changing the original', () => {
		const customized = customizeBlueprint( blueprint, {
			phpVersion: '8.4',
			wpVersion: 'latest',
			siteTitle: 'Edited',
			siteUrl: 'http://edited.local',
		} );

		expect( inspectBlueprint( customized ) ).toMatchObject( {
			phpVersion: '8.4',
			wpVersion: 'latest',
			siteTitle: 'Edited',
			siteUrl: 'http://edited.local',
		} );
		expect( customized.siteOptions ).toEqual( { blogname: 'Edited' } );
		expect( inspectBlueprint( blueprint ).siteTitle ).toBe( 'Fern & Fig' );
	} );

	it( 'adds nothing the Blueprint does not ask for', () => {
		const plain: Blueprint = {
			steps: [ { step: 'setSiteOptions', options: { blogdescription: 'x' } } ],
		};
		expect(
			customizeBlueprint( plain, {
				phpVersion: '8.4',
				siteTitle: 'Edited',
				siteUrl: 'http://a.local',
			} )
		).toEqual( plain );
	} );
} );
