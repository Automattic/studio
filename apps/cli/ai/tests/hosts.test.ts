import { describe, expect, it } from 'vitest';
import { remoteSiteFromStored, storedFromRemoteSite } from 'cli/ai/hosts';
import { buildSystemPrompt } from 'cli/ai/system-prompt';

describe( 'stored site selections', () => {
	it.each( [
		{
			name: 'a WordPress.com site',
			stored: { remote: true, wpcomSiteId: 123 },
			remote: { host: 'wpcom', id: 123 },
			written: { remote: true, wpcomSiteId: 123 },
		},
		{ name: 'a local site', stored: {}, remote: undefined, written: {} },
		{
			name: 'a local site an older session marked',
			stored: { remote: false },
			remote: undefined,
			written: {},
		},
		{
			name: 'a remote mark without a site id',
			stored: { remote: true },
			remote: undefined,
			written: {},
		},
	] )( 'reads and writes $name', ( { stored, remote, written } ) => {
		expect( remoteSiteFromStored( stored ) ).toEqual( remote );
		expect( storedFromRemoteSite( remoteSiteFromStored( stored ) ) ).toEqual( written );
	} );
} );

it( "states each host's sites in the Environment section as before hosts", () => {
	expect( buildSystemPrompt() ).toContain(
		"- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (`wp-includes/`, `wp-admin/`) and every installed theme and plugin (`wp-content/`) are on disk, and are the reference for how WordPress behaves.\n- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.\n- The active site is the one the user has open in Studio."
	);
} );

it( "states each host's sites in the Environment section an external agent gets", () => {
	expect( buildSystemPrompt( { external: true } ) ).toContain(
		"are the reference for how WordPress behaves.\n- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.\n- Studio's skills are runbooks"
	);
} );
