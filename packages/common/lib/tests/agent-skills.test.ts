import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import {
	installAiInstructionsToSite,
	installSkillToSite,
	renderRuntimeInstructions,
	updateManagedInstructionFiles,
} from '../agent-skills';
import { pathExists, recursiveCopyDirectory } from '../fs-utils';
import { SITE_RUNTIME_NATIVE_PHP, SITE_RUNTIME_PLAYGROUND } from '../site-runtime';

vi.mock( 'fs' );

vi.mock( '../fs-utils', () => ( {
	pathExists: vi.fn(),
	recursiveCopyDirectory: vi.fn(),
} ) );

const SITE_PATH = '/test/my-site';
const BUNDLED_PATH = '/mock/server-files/skills';

describe( 'installAiInstructionsToSite', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.symlink ).mockResolvedValue( undefined );
		// readFile echoes the source path back as the "content" so writeFile
		// assertions can verify the source→destination mapping in one call.
		vi.mocked( fs.promises.readFile ).mockImplementation( async ( p ) => p as string );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );
	} );

	it( 'writes loose .md files to site root', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'AGENTS.md' ),
			path.join( BUNDLED_PATH, 'AGENTS.md' )
		);
		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'STUDIO.md' ),
			path.join( BUNDLED_PATH, 'STUDIO.md' )
		);
	} );

	it( 'skips .md files that already exist when overwrite is false', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			if ( p === path.join( SITE_PATH, 'AGENTS.md' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH,
			[],
			false
		);

		expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'STUDIO.md' ),
			path.join( BUNDLED_PATH, 'STUDIO.md' )
		);
	} );

	it( 'skips skill directories not in the user-selected list', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH || p === path.join( BUNDLED_PATH, 'studio-cli' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'skips skill directories even with overwrite when not in user-selected list', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return true;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'wp-rest-api', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH,
			[],
			true
		);

		expect( fs.promises.rm ).not.toHaveBeenCalled();
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
	} );

	it( 'skips when bundled path does not exist', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
		expect( fs.promises.writeFile ).not.toHaveBeenCalled();
	} );

	it( 'writes .md files but skips unselected skill directories', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH || p === path.join( BUNDLED_PATH, 'studio-cli' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 1 );
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'ignores non-.md files at the root level', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'index.ts', isFile: () => true, isDirectory: () => false },
			{ name: 'raw-imports.d.ts', isFile: () => true, isDirectory: () => false },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'AGENTS.md' ),
			path.join( BUNDLED_PATH, 'AGENTS.md' )
		);
	} );

	it( 'writes only .md files when skill directories are not user-selected', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'AGENTS.md', isFile: () => true, isDirectory: () => false },
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
			{ name: 'studio-cli', isFile: () => false, isDirectory: () => true },
			{ name: 'wp-plugin-development', isFile: () => false, isDirectory: () => true },
			{ name: 'wp-block-development', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		// 2 .md files written to site root
		expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 2 );

		// No skill directories installed
		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'does not attempt to install any skills when none are user-selected', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'broken-skill', isFile: () => false, isDirectory: () => true },
			{ name: 'good-skill', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'skips skill directories on any platform when not user-selected', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === BUNDLED_PATH ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'wp-plugin-development', isFile: () => false, isDirectory: () => true },
		] as never );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH,
			[],
			false
		);

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( fs.promises.symlink ).not.toHaveBeenCalled();
	} );

	it( 'renders runtime-conditional content for the site runtime', async () => {
		const studioContent = [
			'Shared line.',
			'<!-- IF playground -->',
			'PLAYGROUND NOTE',
			'<!-- ENDIF playground -->',
			'<!-- IF native-php -->',
			'NATIVE NOTE',
			'<!-- ENDIF native-php -->',
			'',
		].join( '\n' );
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => p === BUNDLED_PATH );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'STUDIO.md', isFile: () => true, isDirectory: () => false },
		] as never );
		vi.mocked( fs.promises.readFile ).mockResolvedValue( studioContent );

		await installAiInstructionsToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_NATIVE_PHP },
			BUNDLED_PATH
		);

		const written = vi.mocked( fs.promises.writeFile ).mock.calls[ 0 ][ 1 ] as string;
		expect( written ).toContain( 'NATIVE NOTE' );
		expect( written ).not.toContain( 'PLAYGROUND NOTE' );
		expect( written ).not.toContain( '<!-- IF' );
	} );
} );

describe( 'installSkillToSite', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( recursiveCopyDirectory ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.rm ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.symlink ).mockResolvedValue( undefined );
		// After recursiveCopyDirectory, the code reads the destination to render
		// .md files. Default to an empty directory so existing tests don't break.
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [] as never );
		vi.mocked( fs.promises.readFile ).mockImplementation( async ( p ) => p as string );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );
	} );

	it( 'installs a skill directory with symlink', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'studio-cli' ) ) {
				return true;
			}
			return false;
		} );

		await installSkillToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH,
			'studio-cli',
			false
		);

		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			path.join( BUNDLED_PATH, 'studio-cli' ),
			path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
		);
		expect( fs.promises.symlink ).toHaveBeenCalledWith(
			path.relative(
				path.join( SITE_PATH, '.claude', 'skills' ),
				path.join( SITE_PATH, '.agents', 'skills', 'studio-cli' )
			),
			path.join( SITE_PATH, '.claude', 'skills', 'studio-cli' )
		);
	} );

	it( 'removes existing skill when overwrite is true', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'wp-rest-api' ) ) {
				return true;
			}
			// SKILL.md exists
			if ( p === path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api', 'SKILL.md' ) ) {
				return true;
			}
			return false;
		} );

		await installSkillToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH,
			'wp-rest-api',
			true
		);

		expect( fs.promises.rm ).toHaveBeenCalledWith(
			path.join( SITE_PATH, '.agents', 'skills', 'wp-rest-api' ),
			{ recursive: true, force: true }
		);
		expect( recursiveCopyDirectory ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'renders runtime-conditional markers in skill .md files', async () => {
		const skillContent = [
			'Shared skill line.',
			'<!-- IF playground -->',
			'PLAYGROUND SKILL NOTE',
			'<!-- ENDIF playground -->',
			'<!-- IF native-php -->',
			'NATIVE SKILL NOTE',
			'<!-- ENDIF native-php -->',
			'',
		].join( '\n' );

		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'my-skill' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'SKILL.md', isFile: () => true, isDirectory: () => false },
		] as never );
		vi.mocked( fs.promises.readFile ).mockResolvedValue( skillContent );

		await installSkillToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_NATIVE_PHP },
			BUNDLED_PATH,
			'my-skill',
			false
		);

		const written = vi.mocked( fs.promises.writeFile ).mock.calls[ 0 ][ 1 ] as string;
		expect( written ).toContain( 'NATIVE SKILL NOTE' );
		expect( written ).not.toContain( 'PLAYGROUND SKILL NOTE' );
		expect( written ).not.toContain( '<!-- IF' );
	} );

	it( 'falls back to junction on Windows EPERM', async () => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );

		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			if ( p === path.join( BUNDLED_PATH, 'wp-plugin-development' ) ) {
				return true;
			}
			return false;
		} );

		const epermError = Object.assign( new Error( 'EPERM' ), { code: 'EPERM' } );
		vi.mocked( fs.promises.symlink )
			.mockRejectedValueOnce( epermError )
			.mockResolvedValue( undefined );

		await installSkillToSite(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH,
			'wp-plugin-development',
			false
		);

		expect( fs.promises.symlink ).toHaveBeenCalledWith(
			path.resolve( path.join( SITE_PATH, '.agents', 'skills', 'wp-plugin-development' ) ),
			path.join( SITE_PATH, '.claude', 'skills', 'wp-plugin-development' ),
			'junction'
		);

		Object.defineProperty( process, 'platform', { value: originalPlatform } );
	} );
} );

describe( 'updateManagedInstructionFiles', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( fs.promises.readFile ).mockImplementation( async ( p ) => p as string );
		vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );
	} );

	it( 'updates STUDIO.md when it exists in the site', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );

		await updateManagedInstructionFiles(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'STUDIO.md' ),
			path.join( BUNDLED_PATH, 'STUDIO.md' )
		);
		expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'skips files that do not exist in the site', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			// Only STUDIO.md exists in both site and bundled
			if ( p === path.join( SITE_PATH, 'STUDIO.md' ) ) {
				return true;
			}
			if ( p === path.join( BUNDLED_PATH, 'STUDIO.md' ) ) {
				return true;
			}
			return false;
		} );

		await updateManagedInstructionFiles(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 1 );
		expect( fs.promises.writeFile ).toHaveBeenCalledWith(
			path.join( SITE_PATH, 'STUDIO.md' ),
			path.join( BUNDLED_PATH, 'STUDIO.md' )
		);
	} );

	it( 'skips files that do not exist in the bundled path', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => {
			// CLAUDE.md exists in site but not in bundled
			if ( p === path.join( SITE_PATH, 'CLAUDE.md' ) ) {
				return true;
			}
			if ( p === path.join( BUNDLED_PATH, 'CLAUDE.md' ) ) {
				return false;
			}
			return false;
		} );

		await updateManagedInstructionFiles(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).not.toHaveBeenCalled();
	} );

	it( 'does nothing when no managed files exist in the site', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await updateManagedInstructionFiles(
			{ path: SITE_PATH, runtime: SITE_RUNTIME_PLAYGROUND },
			BUNDLED_PATH
		);

		expect( fs.promises.writeFile ).not.toHaveBeenCalled();
	} );
} );

describe( 'renderRuntimeInstructions', () => {
	const content = [
		'Shared line.',
		'<!-- IF playground -->',
		'PLAYGROUND ONLY',
		'<!-- ENDIF playground -->',
		'<!-- IF native-php -->',
		'NATIVE ONLY',
		'<!-- ENDIF native-php -->',
		'Outro line.',
		'',
	].join( '\n' );

	it( 'keeps Playground blocks and strips native blocks for playground', () => {
		const rendered = renderRuntimeInstructions( content, SITE_RUNTIME_PLAYGROUND );

		expect( rendered ).toContain( 'PLAYGROUND ONLY' );
		expect( rendered ).not.toContain( 'NATIVE ONLY' );
		expect( rendered ).not.toContain( '<!-- IF' );
		expect( rendered ).not.toContain( '<!-- ENDIF' );
		expect( rendered ).toContain( 'Shared line.' );
		expect( rendered ).toContain( 'Outro line.' );
	} );

	it( 'keeps native blocks and strips Playground blocks for native-php', () => {
		const rendered = renderRuntimeInstructions( content, SITE_RUNTIME_NATIVE_PHP );

		expect( rendered ).toContain( 'NATIVE ONLY' );
		expect( rendered ).not.toContain( 'PLAYGROUND ONLY' );
		expect( rendered ).not.toContain( '<!-- IF' );
	} );

	it( 'leaves content without markers unchanged', () => {
		const plain = 'Just some instructions.\nNo markers here.\n';
		expect( renderRuntimeInstructions( plain, SITE_RUNTIME_NATIVE_PHP ) ).toBe( plain );
	} );

	it( 'preserves a conditional table row only for the matching runtime', () => {
		const table = [
			"| Don't | Do instead |",
			'|-------|-----------|',
			'| Use bare `wp` CLI | Use `studio wp` |',
			'<!-- IF playground -->',
			'| Use `wp shell` | Use `studio wp eval` |',
			'<!-- ENDIF playground -->',
			'| Hardcode ports | Use `studio status` |',
			'',
		].join( '\n' );

		expect( renderRuntimeInstructions( table, SITE_RUNTIME_PLAYGROUND ) ).toContain(
			'| Use `wp shell` | Use `studio wp eval` |'
		);
		expect( renderRuntimeInstructions( table, SITE_RUNTIME_NATIVE_PHP ) ).not.toContain(
			'wp shell'
		);
	} );
} );
