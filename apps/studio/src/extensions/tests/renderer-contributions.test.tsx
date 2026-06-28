import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioExtensionSidebarSections } from 'src/extensions/components/studio-extension-sidebar-sections';
import { useActiveStudioExtensions } from 'src/extensions/hooks/use-active-studio-extensions';
import {
	useStudioExtensionAccountSections,
	useStudioExtensionSettingsTabs,
} from 'src/extensions/hooks/use-studio-extension-settings';

const SAMPLE_EXTENSION_ID = 'sample-development-extension';

const sampleRendererExtension = vi.hoisted( () => ( {
	manifest: {
		id: 'sample-development-extension',
		name: 'Sample Development Extension',
		description: 'Adds sample extension contributions.',
		version: '1.0.0',
	},
	sidebarSections: [
		{
			id: 'sample-sidebar',
			component: () => null,
		},
	],
	settingsTabs: [
		{
			name: 'sample-settings',
			title: 'Sample',
			component: () => null,
		},
	],
	accountSections: [
		{
			id: 'sample-account',
			title: 'Sample Account',
			description: 'Adds a sample account section.',
			component: () => null,
		},
	],
} ) );
const dynamicRendererExtension = vi.hoisted( () => ( {
	manifest: {
		id: 'dynamic-development-extension',
		name: 'Dynamic Development Extension',
		description: 'Adds dynamic extension contributions.',
		version: '1.0.0',
	},
	sidebarSections: [
		{
			id: 'dynamic-sidebar',
			component: () => null,
		},
	],
} ) );
const mockLoadStudioRendererExtension = vi.hoisted( () => vi.fn() );

const mockExtensionsQuery = vi.hoisted( () => ( {
	data: [] as {
		id: string;
		name: string;
		description: string;
		version: string;
		kind: 'user';
		installed: boolean;
		enabled: boolean;
		status: 'available' | 'installed' | 'missing' | 'unsupported';
		isSupported: boolean;
		installedPath?: string;
		renderer?: string;
	}[],
	isLoading: false,
} ) );

vi.mock( 'src/extensions/renderer-registry', () => ( {
	registeredStudioRendererExtensions: [ sampleRendererExtension ],
	loadStudioRendererExtension: mockLoadStudioRendererExtension,
} ) );

vi.mock( 'src/stores/installed-apps-api', () => ( {
	useGetStudioExtensionsQuery: () => mockExtensionsQuery,
} ) );

const sampleListItem = {
	id: SAMPLE_EXTENSION_ID,
	name: 'Sample Development Extension',
	description: 'Adds sample extension contributions.',
	version: '1.0.0',
	kind: 'user' as const,
	installed: false,
	enabled: false,
	status: 'available' as const,
	isSupported: true,
};

function renderContributionHooks() {
	return renderHook( () => ( {
		active: useActiveStudioExtensions(),
		sidebar: useStudioExtensionSidebarSections(),
		settingsTabs: useStudioExtensionSettingsTabs(),
		accountSections: useStudioExtensionAccountSections(),
	} ) );
}

describe( 'Studio extension renderer contributions', () => {
	beforeEach( () => {
		mockExtensionsQuery.data = [ sampleListItem ];
		mockExtensionsQuery.isLoading = false;
		mockLoadStudioRendererExtension.mockReset();
		mockLoadStudioRendererExtension.mockResolvedValue( dynamicRendererExtension );
	} );

	it( 'does not expose renderer contributions before an extension is installed', () => {
		const { result } = renderContributionHooks();

		expect( result.current.active.extensions ).toEqual( [] );
		expect( result.current.sidebar.sections ).toEqual( [] );
		expect( result.current.settingsTabs ).toEqual( [] );
		expect( result.current.accountSections ).toEqual( [] );
	} );

	it( 'does not expose renderer contributions when an extension is installed but disabled', () => {
		mockExtensionsQuery.data = [
			{ ...sampleListItem, installed: true, enabled: false, status: 'installed' },
		];

		const { result } = renderContributionHooks();

		expect( result.current.active.extensions ).toEqual( [] );
		expect( result.current.sidebar.sections ).toEqual( [] );
		expect( result.current.settingsTabs ).toEqual( [] );
		expect( result.current.accountSections ).toEqual( [] );
	} );

	it( 'does not expose renderer contributions when an installed extension is unsupported', () => {
		mockExtensionsQuery.data = [
			{
				...sampleListItem,
				installed: true,
				enabled: true,
				status: 'unsupported',
				isSupported: false,
			},
		];

		const { result } = renderContributionHooks();

		expect( result.current.active.extensions ).toEqual( [] );
		expect( result.current.sidebar.sections ).toEqual( [] );
		expect( result.current.settingsTabs ).toEqual( [] );
		expect( result.current.accountSections ).toEqual( [] );
	} );

	it( 'exposes renderer contributions when an extension is installed and enabled', () => {
		mockExtensionsQuery.data = [
			{ ...sampleListItem, installed: true, enabled: true, status: 'installed' },
		];

		const { result } = renderContributionHooks();

		expect(
			result.current.active.extensions.map( ( extension ) => extension.manifest.id )
		).toEqual( [ SAMPLE_EXTENSION_ID ] );
		expect( result.current.sidebar.sections.map( ( section ) => section.id ) ).toEqual( [
			'sample-sidebar',
		] );
		expect( result.current.settingsTabs.map( ( tab ) => tab.name ) ).toEqual( [
			'sample-settings',
		] );
		expect( result.current.accountSections.map( ( section ) => section.id ) ).toEqual( [
			'sample-account',
		] );
	} );

	it( 'loads renderer contributions from enabled installed extension packages', async () => {
		mockExtensionsQuery.data = [
			{
				...sampleListItem,
				id: 'dynamic-development-extension',
				name: 'Dynamic Development Extension',
				installed: true,
				enabled: true,
				status: 'installed',
				installedPath: '/mock/extensions/dynamic-development-extension',
				renderer: 'renderer.js',
			},
		];

		const { result } = renderContributionHooks();

		await waitFor( () => {
			expect( result.current.sidebar.sections.map( ( section ) => section.id ) ).toEqual( [
				'dynamic-sidebar',
			] );
		} );
		expect( mockLoadStudioRendererExtension ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'dynamic-development-extension',
				installedPath: '/mock/extensions/dynamic-development-extension',
				renderer: 'renderer.js',
			} )
		);
	} );
} );
