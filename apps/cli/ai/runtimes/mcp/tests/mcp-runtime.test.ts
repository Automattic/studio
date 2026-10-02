import { describe, expect, it } from 'vitest';
import { mcpHostCapabilities } from '../index';

describe( 'mcpHostCapabilities', () => {
	const options = {
		imageGeneration: false,
		reloadPreview: async () => undefined,
	};
	const client = { apps: false, roots: false, ownImages: false };

	it( 'leaves questions and design previews to the host agent', () => {
		const host = mcpHostCapabilities( client, options );
		expect( host.askUser ).toBeUndefined();
		expect( host.canAskUser ).toBe( true );
		expect( host.designPreviews ).toBe( 'return' );
	} );

	it( 'leaves image generation to clients that have their own', () => {
		const withImages = { ...options, imageGeneration: true };
		expect( mcpHostCapabilities( client, withImages ).imageGeneration ).toBe( true );
		const host = mcpHostCapabilities( { ...client, ownImages: true }, withImages );
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
