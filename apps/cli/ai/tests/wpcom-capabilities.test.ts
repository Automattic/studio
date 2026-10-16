import { describe, expect, it } from 'vitest';
import {
	describeWpcomSiteCapabilities,
	getWpcomWriteRefusal,
	parseWpcomSiteCapabilities,
	type WpcomSiteCapabilities,
} from '../wpcom-capabilities';
// plan.features.active from real WordPress.com sites on each plan.
import planFeatures from './fixtures/wpcom-plan-features.json';

const admin = { manage_options: true, edit_posts: true };

function site( plan: keyof typeof planFeatures, capabilities = admin ): WpcomSiteCapabilities {
	return parseWpcomSiteCapabilities( {
		plan: { product_name_short: plan, features: { active: planFeatures[ plan ] } },
		capabilities,
	} )!;
}

const globalStyles = ( css = '' ) => ( {
	method: 'POST',
	path: '/global-styles/12',
	apiNamespace: 'wp/v2',
	body: { styles: { color: { text: '#111' }, ...( css ? { css } : {} ) } },
} );
const installPlugin = { method: 'POST', path: '/plugins/jetpack/install', apiNamespace: '' };

describe( 'describeWpcomSiteCapabilities', () => {
	it( 'states what each plan includes and lacks', () => {
		expect( describeWpcomSiteCapabilities( site( 'Free' ) ) ).toBe(
			'Free plan; not Global Styles, custom CSS, installing plugins, uploading themes, premium themes, SSH and SFTP, staging sites, Studio push and pull; you manage this site'
		);
		const personal = describeWpcomSiteCapabilities( site( 'Personal' ) );
		expect( personal ).toContain( 'includes Global Styles, installing plugins' );
		expect( personal ).toContain( 'not custom CSS' );
		expect( describeWpcomSiteCapabilities( site( 'Business' ) ) ).not.toContain( '; not ' );
	} );

	it( 'states the user role', () => {
		expect(
			describeWpcomSiteCapabilities(
				site( 'Business', { manage_options: false, edit_posts: true } )
			)
		).toContain( 'you edit content only' );
	} );
} );

describe( 'getWpcomWriteRefusal', () => {
	it( 'refuses Global Styles where the plan lacks them, naming the route', () => {
		const refusal = getWpcomWriteRefusal( site( 'Free' ), globalStyles() );
		expect( refusal ).toContain( 'Free plan does not include Global Styles' );
		expect( refusal ).toContain( 'hosting-plans-helper' );
		expect( getWpcomWriteRefusal( site( 'Personal' ), globalStyles() ) ).toBeUndefined();
	} );

	it( 'refuses custom CSS on Personal and allows it on Premium', () => {
		expect( getWpcomWriteRefusal( site( 'Personal' ), globalStyles( 'body{}' ) ) ).toContain(
			'does not include custom CSS'
		);
		expect( getWpcomWriteRefusal( site( 'Premium' ), globalStyles( 'body{}' ) ) ).toBeUndefined();
	} );

	it( 'gates plugin installs by plan', () => {
		expect( getWpcomWriteRefusal( site( 'Free' ), installPlugin ) ).toContain(
			'installing plugins'
		);
		expect( getWpcomWriteRefusal( site( 'Personal' ), installPlugin ) ).toBeUndefined();
	} );

	it( 'refuses admin changes to a user who does not manage the site', () => {
		const editor = site( 'Business', { manage_options: false, edit_posts: true } );
		expect( getWpcomWriteRefusal( editor, installPlugin ) ).toContain( 'A site administrator' );
		expect(
			getWpcomWriteRefusal( editor, { method: 'POST', path: '/posts', apiNamespace: 'wp/v2' } )
		).toBeUndefined();
	} );

	it( 'never gates reads or content writes', () => {
		expect(
			getWpcomWriteRefusal( site( 'Free' ), { method: 'GET', path: '/plugins', apiNamespace: '' } )
		).toBeUndefined();
		expect(
			getWpcomWriteRefusal( site( 'Free' ), {
				method: 'POST',
				path: '/pages/4',
				apiNamespace: 'wp/v2',
			} )
		).toBeUndefined();
	} );
} );
