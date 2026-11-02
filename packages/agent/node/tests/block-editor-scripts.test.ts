import { expect, it, vi } from 'vitest';
import { blockEditorScripts } from '@studio/agent/node/block-editor-scripts';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

// The site's block editor registers none of the blocks it is asked about.
vi.mock( '@studio/agent/node/block-validator', () => ( {
	unregisteredInEditor: async ( names: string[] ) => names,
} ) );

// As run h2h5's pet store installed Jetpack from WordPress.org beside a plugin of its own.
it( 'leaves out the blocks of a plugin WordPress updates', async () => {
	const site = createSite();
	site.setOptions( {
		_site_transient_update_plugins:
			'O:8:"stdClass":1:{s:9:"no_update";a:1:{s:19:"jetpack/jetpack.php";s:0:"";}}',
	} );
	const plugins = `${ site.root }/wp-content/plugins`;
	const host = createFakeHost();
	vi.mocked( host.sites.wpCli ).mockResolvedValue( {
		exitCode: 0,
		stderr: '',
		stdout: `WITHOUT_EDITOR_SCRIPT=${ JSON.stringify( {
			'jetpack/podcast-episode': [ `${ plugins }/jetpack/blocks/podcast-episode/block.json` ],
			'acme/notice': [ `${ plugins }/acme/blocks/notice/block.json` ],
		} ) }`,
	} );
	const hostSite = { path: site.root, url: 'http://localhost:8881', name: 'Paws' } as HostSite;
	const { reports } = await blockEditorScripts.check(
		hostSite,
		{ code: 'a' },
		{ code: 'b' },
		host
	);
	expect( reports[ 0 ].problem ).toContain(
		`WordPress registers acme/notice (${ plugins }/acme/blocks/notice/block.json) with no editor script.`
	);
	expect( reports[ 0 ].problem ).not.toContain( 'jetpack' );
} );
