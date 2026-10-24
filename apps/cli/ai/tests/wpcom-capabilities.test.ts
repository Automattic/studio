import { describe, expect, it } from 'vitest';
import {
	describeWpcomSiteCapabilities,
	getWpcomWriteRefusal,
	parseWpcomSiteCapabilities,
	parseWpcomUpgradePlans,
	type WpcomSiteCapabilities,
} from '../wpcom-capabilities';
// plan.features.active from real WordPress.com sites on each plan.
import planFeatures from './fixtures/wpcom-plan-features.json';

const admin = { manage_options: true, edit_posts: true };

function site( plan: keyof typeof planFeatures, capabilities = admin ): WpcomSiteCapabilities {
	return parseWpcomSiteCapabilities( {
		plan: {
			product_name_short: plan,
			features: {
				active: planFeatures[ plan ],
				available: {
					'install-plugins': [ 'personal-bundle', 'value_bundle', 'business-bundle', 'pro-plan' ],
					'custom-design': [ 'business-bundle', 'pro-plan' ],
				},
			},
		},
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

// From a site's /sites/:id/plans: plans without a plan card are no longer offered, and
// Premium stands for a plan the site can only move down to.
const upgradePlans = async () =>
	parseWpcomUpgradePlans( {
		'1': { product_slug: 'free_plan', plan_card_name: 'Free', plan_card_order: 1 },
		'1008': {
			product_slug: 'business-bundle',
			plan_card_name: 'Business',
			plan_card_order: 4,
			available_for_upgrade: true,
		},
		'1009': {
			product_slug: 'personal-bundle',
			plan_card_name: 'Personal',
			plan_card_order: 2,
			available_for_upgrade: true,
		},
		'1003': {
			product_slug: 'value_bundle',
			plan_card_name: 'Premium',
			plan_card_order: 3,
			available_for_upgrade: false,
		},
		'1032': { product_slug: 'pro-plan', available_for_upgrade: true },
	} );

it( 'states the plan and the user role', () => {
	expect( describeWpcomSiteCapabilities( site( 'Free' ) ) ).toBe(
		'Free plan; you manage this site'
	);
	expect(
		describeWpcomSiteCapabilities( site( 'Business', { manage_options: false, edit_posts: true } ) )
	).toBe( 'Business plan; you edit content only' );
} );

describe( 'getWpcomWriteRefusal', () => {
	it( 'refuses a write the plan lacks a feature for, naming the plans offered that have it', async () => {
		expect( await getWpcomWriteRefusal( site( 'Free' ), installPlugin, upgradePlans ) ).toBe(
			"Not sent: this site's Free plan does not include install-plugins (WordPress.com plan features). Plans that include it: Personal, Business."
		);
		expect( await getWpcomWriteRefusal( site( 'Free' ), globalStyles(), upgradePlans ) ).toContain(
			'does not include global-styles ('
		);
		expect( await getWpcomWriteRefusal( site( 'Personal' ), globalStyles() ) ).toBeUndefined();
	} );

	it( 'refuses custom CSS on Personal and allows it on Premium', async () => {
		expect(
			await getWpcomWriteRefusal( site( 'Personal' ), globalStyles( 'body{}' ), upgradePlans )
		).toContain(
			'does not include custom-design (WordPress.com plan features). Plans that include it: Business.'
		);
		expect(
			await getWpcomWriteRefusal( site( 'Premium' ), globalStyles( 'body{}' ) )
		).toBeUndefined();
	} );

	it( 'gates plugin installs by plan', async () => {
		expect( await getWpcomWriteRefusal( site( 'Free' ), installPlugin ) ).toContain(
			'install-plugins'
		);
		expect( await getWpcomWriteRefusal( site( 'Personal' ), installPlugin ) ).toBeUndefined();
	} );

	it( 'refuses admin changes to a user who does not manage the site', async () => {
		const editor = site( 'Business', { manage_options: false, edit_posts: true } );
		expect( await getWpcomWriteRefusal( editor, installPlugin ) ).toContain(
			'A site administrator'
		);
		expect(
			await getWpcomWriteRefusal( editor, {
				method: 'POST',
				path: '/posts',
				apiNamespace: 'wp/v2',
			} )
		).toBeUndefined();
	} );

	it( 'never gates reads or content writes', async () => {
		expect(
			await getWpcomWriteRefusal( site( 'Free' ), {
				method: 'GET',
				path: '/plugins',
				apiNamespace: '',
			} )
		).toBeUndefined();
		expect(
			await getWpcomWriteRefusal( site( 'Free' ), {
				method: 'POST',
				path: '/pages/4',
				apiNamespace: 'wp/v2',
			} )
		).toBeUndefined();
	} );
} );
