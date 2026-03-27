import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	getClaudeCodePlugins,
	getClaudeCodeSkillCommands,
	isClaudeCodePluginProvider,
} from 'cli/ai/claude-code-plugins';

vi.mock( 'fs', () => ( {
	default: {
		readFileSync: vi.fn(),
		readdirSync: vi.fn(),
		existsSync: vi.fn(),
	},
} ) );

const MANIFEST_PATH = path.join( os.homedir(), '.claude', 'plugins', 'installed_plugins.json' );

function mockManifest(
	plugins: Record< string, Array< { scope: string; installPath: string } > >
) {
	vi.mocked( fs.readFileSync ).mockImplementation( ( filePath ) => {
		if ( toForwardSlash( String( filePath ) ) === toForwardSlash( MANIFEST_PATH ) ) {
			return JSON.stringify( { version: 2, plugins } );
		}
		throw new Error( `Unexpected readFileSync: ${ filePath }` );
	} );
	vi.mocked( fs.existsSync ).mockReturnValue( true );
}

function toForwardSlash( p: string ): string {
	return p.replace( /\\/g, '/' );
}

function mockPluginFiles( rawFileMap: Record< string, string > ) {
	const fileMap: Record< string, string > = {};
	for ( const [ key, value ] of Object.entries( rawFileMap ) ) {
		fileMap[ toForwardSlash( key ) ] = value;
	}
	vi.mocked( fs.readFileSync ).mockImplementation( ( filePath ) => {
		const content = fileMap[ toForwardSlash( String( filePath ) ) ];
		if ( content !== undefined ) {
			return content;
		}
		throw new Error( `ENOENT: ${ filePath }` );
	} );
	vi.mocked( fs.existsSync ).mockImplementation( ( filePath ) => {
		const normalized = toForwardSlash( String( filePath ) );
		return (
			normalized in fileMap ||
			Object.keys( fileMap ).some( ( key ) => key.startsWith( normalized ) )
		);
	} );
	vi.mocked( fs.readdirSync ).mockImplementation( ( ( dirPath: fs.PathLike ) => {
		const prefix = toForwardSlash( String( dirPath ) ) + '/';
		const entries = new Set< string >();
		for ( const key of Object.keys( fileMap ) ) {
			if ( key.startsWith( prefix ) ) {
				const remainder = key.slice( prefix.length );
				const firstSegment = remainder.split( '/' )[ 0 ];
				entries.add( firstSegment );
			}
		}
		if ( entries.size === 0 ) {
			throw new Error( `ENOENT: ${ dirPath }` );
		}
		return [ ...entries ] as unknown as fs.Dirent[];
	} ) as unknown as typeof fs.readdirSync );
}

describe( 'isClaudeCodePluginProvider', () => {
	it( 'returns true for anthropic-claude', () => {
		expect( isClaudeCodePluginProvider( 'anthropic-claude' ) ).toBe( true );
	} );

	it( 'returns true for anthropic-api-key', () => {
		expect( isClaudeCodePluginProvider( 'anthropic-api-key' ) ).toBe( true );
	} );

	it( 'returns false for wpcom', () => {
		expect( isClaudeCodePluginProvider( 'wpcom' ) ).toBe( false );
	} );

	it( 'returns false for undefined', () => {
		expect( isClaudeCodePluginProvider( undefined ) ).toBe( false );
	} );
} );

describe( 'getClaudeCodePlugins', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'returns plugin paths from the manifest', () => {
		mockManifest( {
			'my-plugin@marketplace': [ { scope: 'user', installPath: '/path/to/plugin' } ],
		} );

		expect( getClaudeCodePlugins() ).toEqual( [ { type: 'local', path: '/path/to/plugin' } ] );
	} );

	it( 'returns empty array when manifest does not exist', () => {
		vi.mocked( fs.readFileSync ).mockImplementation( () => {
			throw new Error( 'ENOENT' );
		} );

		expect( getClaudeCodePlugins() ).toEqual( [] );
	} );

	it( 'skips entries where installPath does not exist on disk', () => {
		vi.mocked( fs.readFileSync ).mockImplementation( ( filePath ) => {
			if ( toForwardSlash( String( filePath ) ) === toForwardSlash( MANIFEST_PATH ) ) {
				return JSON.stringify( {
					version: 2,
					plugins: {
						'plugin@market': [
							{ scope: 'user', installPath: '/exists' },
							{ scope: 'user', installPath: '/gone' },
						],
					},
				} );
			}
			throw new Error( 'ENOENT' );
		} );
		vi.mocked( fs.existsSync ).mockImplementation( ( p ) => ( p as string ) === '/exists' );

		expect( getClaudeCodePlugins() ).toEqual( [ { type: 'local', path: '/exists' } ] );
	} );
} );

describe( 'getClaudeCodeSkillCommands', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'returns skills with short label and prefixed value', () => {
		const pluginPath = '/plugins/my-plugin';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'my-plugin@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			[ `${ pluginPath }/.claude-plugin/plugin.json` ]: JSON.stringify( { name: 'my-plugin' } ),
			[ `${ pluginPath }/skills/my-skill/SKILL.md` ]:
				'---\nname: my-skill\ndescription: Does things\n---\n# Content',
		};
		mockPluginFiles( fileMap );

		const items = getClaudeCodeSkillCommands();

		expect( items ).toEqual( [
			{
				value: 'my-plugin:my-skill',
				label: 'my-skill',
				description: '(my-plugin) Does things',
			},
		] );
	} );

	it( 'returns commands with prefixed label and value', () => {
		const pluginPath = '/plugins/my-plugin';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'my-plugin@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			[ `${ pluginPath }/.claude-plugin/plugin.json` ]: JSON.stringify( { name: 'my-plugin' } ),
			[ `${ pluginPath }/commands/deploy.md` ]: '---\ndescription: Deploy the site\n---\n# Deploy',
		};
		mockPluginFiles( fileMap );

		const items = getClaudeCodeSkillCommands();

		expect( items ).toEqual( [
			{
				value: 'my-plugin:deploy',
				label: 'my-plugin:deploy',
				description: 'Deploy the site',
			},
		] );
	} );

	it( 'uses frontmatter name for commands when present', () => {
		const pluginPath = '/plugins/my-plugin';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'my-plugin@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			[ `${ pluginPath }/.claude-plugin/plugin.json` ]: JSON.stringify( { name: 'my-plugin' } ),
			[ `${ pluginPath }/commands/deploy.md` ]:
				'---\nname: ship-it\ndescription: Deploy the site\n---\n',
		};
		mockPluginFiles( fileMap );

		const items = getClaudeCodeSkillCommands();

		expect( items ).toEqual( [
			{
				value: 'my-plugin:ship-it',
				label: 'my-plugin:ship-it',
				description: 'Deploy the site',
			},
		] );
	} );

	it( 'scans skills, commands, and agents from a single plugin', () => {
		const pluginPath = '/plugins/full';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'full@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			[ `${ pluginPath }/.claude-plugin/plugin.json` ]: JSON.stringify( { name: 'full' } ),
			[ `${ pluginPath }/skills/tdd/SKILL.md` ]:
				'---\nname: tdd\ndescription: Test driven dev\n---\n',
			[ `${ pluginPath }/commands/commit.md` ]: '---\ndescription: Create commit\n---\n',
			[ `${ pluginPath }/agents/reviewer.md` ]:
				'---\nname: code-reviewer\ndescription: Reviews code\n---\n',
		};
		mockPluginFiles( fileMap );

		const items = getClaudeCodeSkillCommands();

		expect( items ).toHaveLength( 3 );
		expect( items ).toContainEqual( {
			value: 'full:tdd',
			label: 'tdd',
			description: '(full) Test driven dev',
		} );
		expect( items ).toContainEqual( {
			value: 'full:commit',
			label: 'full:commit',
			description: 'Create commit',
		} );
		expect( items ).toContainEqual( {
			value: 'full:code-reviewer',
			label: 'full:code-reviewer',
			description: 'Reviews code',
		} );
	} );

	it( 'returns empty array when no plugins are installed', () => {
		vi.mocked( fs.readFileSync ).mockImplementation( () => {
			throw new Error( 'ENOENT' );
		} );

		expect( getClaudeCodeSkillCommands() ).toEqual( [] );
	} );

	it( 'skips plugins without a valid plugin.json', () => {
		const pluginPath = '/plugins/broken';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'broken@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			// No plugin.json — readFileSync will throw
			[ `${ pluginPath }/skills/something/SKILL.md` ]: '---\nname: something\n---\n',
		};
		mockPluginFiles( fileMap );

		expect( getClaudeCodeSkillCommands() ).toEqual( [] );
	} );

	it( 'skips skills without a name in frontmatter', () => {
		const pluginPath = '/plugins/my-plugin';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'my-plugin@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			[ `${ pluginPath }/.claude-plugin/plugin.json` ]: JSON.stringify( { name: 'my-plugin' } ),
			[ `${ pluginPath }/skills/noname/SKILL.md` ]: '# Just a heading, no frontmatter',
		};
		mockPluginFiles( fileMap );

		expect( getClaudeCodeSkillCommands() ).toEqual( [] );
	} );

	it( 'handles quoted name and description in frontmatter', () => {
		const pluginPath = '/plugins/my-plugin';
		const fileMap: Record< string, string > = {
			[ MANIFEST_PATH ]: JSON.stringify( {
				version: 2,
				plugins: { 'my-plugin@market': [ { scope: 'user', installPath: pluginPath } ] },
			} ),
			[ `${ pluginPath }/.claude-plugin/plugin.json` ]: JSON.stringify( { name: 'my-plugin' } ),
			[ `${ pluginPath }/skills/quoted/SKILL.md` ]:
				'---\nname: "quoted-skill"\ndescription: "A quoted description"\n---\n',
		};
		mockPluginFiles( fileMap );

		const items = getClaudeCodeSkillCommands();

		expect( items ).toEqual( [
			{
				value: 'my-plugin:quoted-skill',
				label: 'quoted-skill',
				description: '(my-plugin) A quoted description',
			},
		] );
	} );
} );
