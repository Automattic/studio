import { describe, expect, it } from 'vitest';
import { mcpHostCapabilities } from '../index';

describe( 'mcpHostCapabilities', () => {
	const options = {
		imageGeneration: false,
		reloadPreview: async () => undefined,
	};
	const client = { apps: false, roots: false, widgets: false };

	it( 'leaves questions and design previews to the host agent', () => {
		const host = mcpHostCapabilities( client, options );
		expect( host.askUser ).toBeUndefined();
		expect( host.canAskUser ).toBe( true );
		expect( host.designPreviews ).toBe( 'return' );
	} );

	it( 'shows design options the way each client can', () => {
		expect( mcpHostCapabilities( { ...client, apps: true }, options ).designOptionsView ).toBe(
			'picker'
		);
		expect( mcpHostCapabilities( { ...client, widgets: true }, options ).designOptionsView ).toBe(
			'widget'
		);
		expect( mcpHostCapabilities( client, options ).designOptionsView ).toBeUndefined();
	} );

	it( 'leaves image generation to clients that have their own', () => {
		const withImages = { ...options, imageGeneration: true };
		expect( mcpHostCapabilities( client, withImages ).imageGeneration ).toBe( true );
		const host = mcpHostCapabilities( { ...client, imageTool: 'image_gen' }, withImages );
		expect( host.hostImageTool ).toBe( 'image_gen' );
	} );

	it( 'saves images for the user in the client workspace only when it shares its roots', () => {
		const withDirectory = {
			...options,
			displayDirectory: async () => '/workspace/.wordpress-studio',
		};
		expect(
			mcpHostCapabilities( { ...client, roots: true }, withDirectory ).displayDirectory
		).toBeDefined();
		expect( mcpHostCapabilities( client, withDirectory ).displayDirectory ).toBeUndefined();
	} );

	it( 'offers refresh_browser only once the Studio UI is open', () => {
		expect( mcpHostCapabilities( client, options ).reloadPreview ).toBeUndefined();
		expect(
			mcpHostCapabilities( client, {
				...options,
				companion: { url: 'http://localhost:8081', siteId: 'site' },
			} ).reloadPreview
		).toBeDefined();
	} );
} );
