/**
 * @vitest-environment node
 */
import { fork, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAiSession as createAiSessionInStore } from '@studio/common/ai/sessions/store';
import {
	listDevelopmentProjects,
	refreshDevelopmentProject,
	updateDevelopmentProjectLinkedSite,
} from '@studio/common/lib/publishing-config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as oauthClient from 'src/lib/oauth';
import { SiteServer } from 'src/site-server';
import {
	addDevelopmentProjectIgnorePattern,
	applyDevelopmentProjectAiPatch,
	getDevelopmentProjectValidationState,
	listDevelopmentProjectReleaseTags,
	listDevelopmentProjectFiles,
	readDevelopmentProjectFile,
	removeDevelopmentProjectIgnorePattern,
	runDevelopmentProjectValidation,
	runDevelopmentProjectAiReview,
	startDevelopmentProjectPlayground,
	switchDevelopmentProjectReleaseTag,
	writeDevelopmentProjectFile,
} from '../ipc-handlers';
import type { DevelopmentProject } from '@studio/common/types/publishing';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'electron', () => ( {
	BrowserWindow: {
		getAllWindows: vi.fn( () => [] ),
	},
	session: {
		fromPartition: vi.fn( () => ( {} ) ),
	},
} ) );

vi.mock( 'child_process', () => ( {
	fork: vi.fn(),
	spawn: vi.fn(),
} ) );

vi.mock( '@studio/common/ai/sessions/store', () => ( {
	createAiSession: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/publishing-config', () => ( {
	addDevelopmentProject: vi.fn(),
	listDevelopmentProjects: vi.fn(),
	refreshDevelopmentProject: vi.fn(),
	removeDevelopmentProject: vi.fn(),
	updateDevelopmentProjectLinkedSite: vi.fn(),
} ) );

vi.mock( 'src/modules/user-settings/lib/wordpress-org-auth', () => ( {
	getSavedWordPressOrgAccount: vi.fn(),
	getWordPressOrgLoginUserAgent: vi.fn( () => 'Studio Test' ),
} ) );

vi.mock( 'src/lib/ai-sessions', () => ( {
	getAiSessionsRootDirectory: vi.fn( () => '/tmp/studio-test-sessions' ),
} ) );

vi.mock( 'src/lib/oauth', () => ( {
	isAuthenticated: vi.fn(),
} ) );

vi.mock( 'src/site-server', () => ( {
	SiteServer: {
		create: vi.fn(),
		get: vi.fn(),
		register: vi.fn(),
	},
} ) );

vi.mock( 'src/storage/paths', () => ( {
	getBundledNodeBinaryPath: vi.fn( () => process.execPath ),
	getCliPath: vi.fn( () => '/mock/studio-cli.mjs' ),
} ) );

const mockIpcMainInvokeEvent = {} as IpcMainInvokeEvent;

let testDir: string;
let testSiteDir: string;
let project: DevelopmentProject;

async function writeFixtureFile( relativePath: string, content: string ) {
	const filePath = path.join( testDir, relativePath );
	await fs.mkdir( path.dirname( filePath ), { recursive: true } );
	await fs.writeFile( filePath, content, 'utf8' );
	return filePath;
}

function createDeferred< T >() {
	let resolve: ( value: T ) => void = () => undefined;
	let reject: ( reason?: unknown ) => void = () => undefined;
	const promise = new Promise< T >( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );
	return { promise, resolve, reject };
}

function mockSvnSpawn(
	handler: ( args: string[] ) => { stdout?: string; stderr?: string; exitCode?: number }
) {
	vi.mocked( spawn ).mockImplementation( ( _command, args ) => {
		const child = new EventEmitter() as unknown as ReturnType< typeof spawn >;
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		Object.assign( child, {
			stdout,
			stderr,
		} );

		const result = handler( ( args ?? [] ) as string[] );
		setImmediate( () => {
			if ( result.stdout ) {
				stdout.emit( 'data', Buffer.from( result.stdout ) );
			}
			if ( result.stderr ) {
				stderr.emit( 'data', Buffer.from( result.stderr ) );
			}
			child.emit( 'close', result.exitCode ?? 0 );
		} );

		return child;
	} );
}

async function moveProjectIntoSvnCheckout() {
	const svnRootDir = path.join( testDir, 'svn-root' );
	const trunkDir = path.join( svnRootDir, 'trunk' );
	const tagsDir = path.join( svnRootDir, 'tags' );
	const mainFile = path.join( trunkDir, 'test-plugin.php' );

	await fs.mkdir( path.join( tagsDir, '1.0.0' ), { recursive: true } );
	await fs.mkdir( path.join( tagsDir, '1.0.1' ), { recursive: true } );
	await fs.mkdir( trunkDir, { recursive: true } );
	await fs.writeFile(
		mainFile,
		`<?php
/**
 * Plugin Name: Test Plugin
 * Version: 1.0.0
 */`,
		'utf8'
	);

	project = {
		...project,
		path: trunkDir,
		info: {
			...project.info!,
			rootDir: trunkDir,
			mainFile,
		},
	};
	vi.mocked( listDevelopmentProjects ).mockResolvedValue( [ project ] );
	vi.mocked( refreshDevelopmentProject ).mockResolvedValue( project );

	return { svnRootDir, trunkDir, tagsDir };
}

describe( 'plugin development IPC handlers', () => {
	beforeEach( async () => {
		vi.clearAllMocks();
		testDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-plugin-ipc-' ) );
		testSiteDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-plugin-site-' ) );
		const mainFile = await writeFixtureFile(
			'test-plugin.php',
			`<?php
/**
 * Plugin Name: Test Plugin
 * Version: 1.0.0
 */`
		);
		project = {
			id: 'project-1',
			type: 'plugin',
			source: 'manual',
			path: testDir,
			name: 'Test Plugin',
			slug: 'test-plugin',
			addedAt: '2026-06-23T00:00:00.000Z',
			updatedAt: '2026-06-23T00:00:00.000Z',
			exists: true,
			info: {
				rootDir: testDir,
				mainFile,
				name: 'Test Plugin',
				slug: 'test-plugin',
				version: '1.0.0',
			},
		};
		vi.mocked( listDevelopmentProjects ).mockResolvedValue( [ project ] );
		vi.mocked( refreshDevelopmentProject ).mockResolvedValue( project );
		vi.mocked( oauthClient.isAuthenticated ).mockResolvedValue( true );
		vi.mocked( createAiSessionInStore ).mockResolvedValue( {
			id: 'session-1',
		} as Awaited< ReturnType< typeof createAiSessionInStore > > );
	} );

	afterEach( async () => {
		await fs.rm( testDir, { force: true, recursive: true } );
		await fs.rm( testSiteDir, { force: true, recursive: true } );
	} );

	it( 'lists editable and previewable project files while skipping hidden and vendor files', async () => {
		await writeFixtureFile( 'readme.txt', '=== Test Plugin ===' );
		await writeFixtureFile( 'assets/style.css', '.plugin { display: block; }' );
		await writeFixtureFile( 'node_modules/package/index.js', 'export {};' );
		await writeFixtureFile( '.hidden.php', '<?php' );
		await writeFixtureFile( 'screenshot.png', 'not really a png' );

		const result = await listDevelopmentProjectFiles( mockIpcMainInvokeEvent, project.id );

		expect( result.truncated ).toBe( false );
		expect( result.directories ).toContainEqual(
			expect.objectContaining( {
				path: 'assets',
				name: 'assets',
				parent: '',
			} )
		);
		expect( result.files.map( ( file ) => file.path ) ).toEqual( [
			'assets/style.css',
			'readme.txt',
			'screenshot.png',
			'test-plugin.php',
		] );
		expect( result.files.find( ( file ) => file.path === 'readme.txt' ) ).toMatchObject( {
			fileKind: 'text',
			editable: true,
			previewable: false,
		} );
		expect( result.files.find( ( file ) => file.path === 'screenshot.png' ) ).toMatchObject( {
			fileKind: 'image',
			mediaType: 'image/png',
			editable: false,
			previewable: true,
		} );
	} );

	it( 'reads raster images as preview-only data urls', async () => {
		await writeFixtureFile( 'screenshot.png', 'not really a png' );

		const result = await readDevelopmentProjectFile(
			mockIpcMainInvokeEvent,
			project.id,
			'screenshot.png'
		);

		expect( result ).toMatchObject( {
			path: 'screenshot.png',
			content: '',
			fileKind: 'image',
			mediaType: 'image/png',
			editable: false,
			previewable: true,
			mode: 'preview',
		} );
		expect( result.dataUrl ).toMatch( /^data:image\/png;base64,/ );
		await expect(
			writeDevelopmentProjectFile( mockIpcMainInvokeEvent, project.id, 'screenshot.png', 'nope' )
		).rejects.toThrow( 'This file cannot be edited in Studio.' );
	} );

	it( 'reads SVG files as editable image previews', async () => {
		await writeFixtureFile(
			'assets/icon.svg',
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
		);

		const result = await readDevelopmentProjectFile(
			mockIpcMainInvokeEvent,
			project.id,
			'assets/icon.svg'
		);

		expect( result ).toMatchObject( {
			path: 'assets/icon.svg',
			fileKind: 'image',
			mediaType: 'image/svg+xml',
			editable: true,
			previewable: true,
			mode: 'preview',
		} );
		expect( result.content ).toContain( '<svg' );
		expect( result.dataUrl ).toContain( 'data:image/svg+xml;charset=utf-8,' );

		const written = await writeDevelopmentProjectFile(
			mockIpcMainInvokeEvent,
			project.id,
			'assets/icon.svg',
			'<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>'
		);
		expect( written ).toMatchObject( {
			path: 'assets/icon.svg',
			fileKind: 'image',
			editable: true,
			previewable: true,
		} );
		expect( written.dataUrl ).toContain( encodeURIComponent( '<circle r="5"/>' ) );
	} );

	it( 'reads and writes files only within the plugin root', async () => {
		await expect(
			readDevelopmentProjectFile( mockIpcMainInvokeEvent, project.id, '../outside.php' )
		).rejects.toThrow( 'File path is outside the plugin project.' );

		const written = await writeDevelopmentProjectFile(
			mockIpcMainInvokeEvent,
			project.id,
			'includes/class-example.php',
			'<?php echo "Updated";'
		);

		expect( written ).toMatchObject( {
			path: 'includes/class-example.php',
			content: '<?php echo "Updated";',
		} );
		await expect(
			fs.readFile( path.join( testDir, 'includes/class-example.php' ), 'utf8' )
		).resolves.toBe( '<?php echo "Updated";' );
	} );

	it( 'applies accepted AI patches and refreshes project metadata', async () => {
		await writeFixtureFile( 'readme.txt', 'Stable tag: 1.0.0' );

		const result = await applyDevelopmentProjectAiPatch( mockIpcMainInvokeEvent, project.id, {
			path: 'readme.txt',
			status: 'modified',
			beforeContent: 'Stable tag: 1.0.0',
			afterContent: 'Stable tag: 1.0.1',
		} );

		expect( result.files.some( ( file ) => file.path === 'readme.txt' ) ).toBe( true );
		await expect( fs.readFile( path.join( testDir, 'readme.txt' ), 'utf8' ) ).resolves.toBe(
			'Stable tag: 1.0.1'
		);
		expect( refreshDevelopmentProject ).toHaveBeenCalledWith( project.id );
	} );

	it( 'stores ignore patterns and annotates matching explorer files', async () => {
		await writeFixtureFile( 'readme.txt', '=== Test Plugin ===' );
		await writeFixtureFile( 'assets/style.css', '.plugin { display: block; }' );

		const result = await addDevelopmentProjectIgnorePattern(
			mockIpcMainInvokeEvent,
			project.id,
			'assets/style.css'
		);

		await expect( fs.readFile( path.join( testDir, '.studioignore' ), 'utf8' ) ).resolves.toBe(
			'assets/style.css\n'
		);
		expect( result.files.find( ( file ) => file.path === 'assets/style.css' ) ).toMatchObject( {
			ignored: true,
			ignoredBy: 'assets/style.css',
		} );
		expect( result.files.find( ( file ) => file.path === 'readme.txt' ) ).toMatchObject( {
			ignored: false,
		} );
	} );

	it( 'annotates folders ignored by directory ignore patterns', async () => {
		await writeFixtureFile( 'assets/style.css', '.plugin { display: block; }' );
		await writeFixtureFile( '.studioignore', 'assets/**\n' );

		const result = await listDevelopmentProjectFiles( mockIpcMainInvokeEvent, project.id );

		expect( result.directories.find( ( directory ) => directory.path === 'assets' ) ).toMatchObject(
			{
				ignored: true,
				ignoredBy: 'assets/**',
			}
		);
		expect( result.files.find( ( file ) => file.path === 'assets/style.css' ) ).toMatchObject( {
			ignored: true,
			ignoredBy: 'assets/**',
		} );
	} );

	it( 'removes ignore patterns and refreshes matching explorer files', async () => {
		await writeFixtureFile( 'assets/style.css', '.plugin { display: block; }' );
		await writeFixtureFile( '.studioignore', 'assets/style.css\n' );

		const result = await removeDevelopmentProjectIgnorePattern(
			mockIpcMainInvokeEvent,
			project.id,
			'assets/style.css'
		);

		await expect( fs.stat( path.join( testDir, '.studioignore' ) ) ).rejects.toThrow();
		expect( result.files.find( ( file ) => file.path === 'assets/style.css' ) ).toMatchObject( {
			ignored: false,
			ignoredBy: undefined,
		} );
	} );

	it( 'migrates legacy pressship ignore files to Studio ignore files', async () => {
		await writeFixtureFile( 'assets/style.css', '.plugin { display: block; }' );
		await writeFixtureFile( '.pressshipignore', 'assets/**\n' );

		const result = await listDevelopmentProjectFiles( mockIpcMainInvokeEvent, project.id );

		await expect( fs.readFile( path.join( testDir, '.studioignore' ), 'utf8' ) ).resolves.toBe(
			'assets/**\n'
		);
		await expect( fs.stat( path.join( testDir, '.pressshipignore' ) ) ).rejects.toThrow();
		expect( result.directories.find( ( directory ) => directory.path === 'assets' ) ).toMatchObject(
			{
				ignored: true,
				ignoredBy: 'assets/**',
			}
		);
	} );

	it( 'runs Studio Code review against a temporary copy and returns patches', async () => {
		await writeFixtureFile( 'readme.txt', 'Stable tag: 1.0.0' );
		let workspacePath = '';
		let sentAnswers: unknown;

		vi.mocked( fork ).mockImplementation( ( _modulePath, args ) => {
			const child = new EventEmitter() as ReturnType< typeof fork >;
			Object.assign( child, {
				connected: true,
				send: vi.fn( ( message ) => {
					sentAnswers = message;
					return true;
				} ),
			} );
			const argv = ( args ?? [] ) as string[];
			workspacePath = argv[ argv.indexOf( '--path' ) + 1 ];

			setImmediate( () => {
				void ( async () => {
					await fs.writeFile( path.join( workspacePath, 'readme.txt' ), 'Stable tag: 1.0.1' );
					await fs.writeFile( path.join( workspacePath, 'new-file.php' ), '<?php echo "new";' );
					child.emit( 'message', {
						type: 'question.asked',
						timestamp: new Date().toISOString(),
						questions: [
							{
								question: 'Allow edits?',
								options: [ { label: 'Allow', description: 'Allow file edits' } ],
							},
						],
					} );
					child.emit( 'message', {
						type: 'turn.completed',
						timestamp: new Date().toISOString(),
						sessionId: 'session-1',
						status: 'success',
					} );
					child.emit( 'exit', 0 );
				} )();
			} );

			return child;
		} );

		const result = await runDevelopmentProjectAiReview( mockIpcMainInvokeEvent, project.id, {
			prompt: 'Bump the stable tag and add a file.',
			selectedPath: 'readme.txt',
		} );

		expect( result.sessionId ).toBe( 'session-1' );
		expect( result.patches ).toEqual( [
			{
				path: 'new-file.php',
				status: 'created',
				afterContent: '<?php echo "new";',
			},
			{
				path: 'readme.txt',
				status: 'modified',
				beforeContent: 'Stable tag: 1.0.0',
				afterContent: 'Stable tag: 1.0.1',
			},
		] );
		expect( sentAnswers ).toEqual( {
			type: 'answer',
			answers: { 'Allow edits?': 'Allow' },
		} );
		await expect( fs.readFile( path.join( testDir, 'readme.txt' ), 'utf8' ) ).resolves.toBe(
			'Stable tag: 1.0.0'
		);
		await expect( fs.stat( workspacePath ) ).rejects.toThrow();
	} );

	it( 'includes complete Plugin Check findings in the Studio Code review prompt when requested', async () => {
		project = {
			...project,
			linkedSiteId: 'site-1',
		};
		vi.mocked( listDevelopmentProjects ).mockResolvedValue( [ project ] );
		const pluginCheckFindings = Array.from( { length: 85 }, ( _, index ) => ( {
			file: '/wordpress/wp-content/plugins/test-plugin/test-plugin.php',
			line: index + 1,
			column: 3,
			type: 'ERROR',
			code: `plugin_error_${ index + 1 }`,
			message: `Plugin error ${ index + 1 }.`,
		} ) );
		const executeWpCliCommand = vi
			.fn()
			.mockResolvedValueOnce( { exitCode: 0, stdout: '', stderr: '' } )
			.mockResolvedValueOnce( { exitCode: 0, stdout: 'Plugin activated.', stderr: '' } )
			.mockResolvedValueOnce( {
				exitCode: 1,
				stdout: JSON.stringify( pluginCheckFindings ),
				stderr: '',
			} );
		const linkedServer = {
			details: {
				id: 'site-1',
				name: 'Linked Site',
				path: testSiteDir,
				port: 8888,
				running: true,
				url: 'http://localhost:8888',
			},
			executeWpCliCommand,
			start: vi.fn(),
		} as unknown as SiteServer;
		vi.mocked( SiteServer.get ).mockImplementation( ( siteId ) =>
			siteId === 'site-1' ? linkedServer : undefined
		);

		await runDevelopmentProjectValidation( mockIpcMainInvokeEvent, project.id );

		let promptPayload = '';
		vi.mocked( fork ).mockImplementation( ( _modulePath, args ) => {
			const child = new EventEmitter() as ReturnType< typeof fork >;
			Object.assign( child, {
				connected: true,
				send: vi.fn(),
			} );
			const argv = ( args ?? [] ) as string[];
			const inputPayloadPath = argv[ argv.indexOf( '--input-payload' ) + 1 ];

			setImmediate( () => {
				void ( async () => {
					const payload = JSON.parse( await fs.readFile( inputPayloadPath, 'utf8' ) ) as {
						prompt: string;
					};
					promptPayload = payload.prompt;
					child.emit( 'message', {
						type: 'turn.completed',
						timestamp: new Date().toISOString(),
						sessionId: 'session-1',
						status: 'success',
					} );
					child.emit( 'exit', 0 );
				} )();
			} );

			return child;
		} );

		await runDevelopmentProjectAiReview( mockIpcMainInvokeEvent, project.id, {
			prompt: 'Fix the plugin.',
			selectedPath: 'test-plugin.php',
			includeAllPluginCheckFindings: true,
		} );

		expect( promptPayload ).toContain( 'Current Plugin Check findings:' );
		expect( promptPayload ).toContain(
			'[error] test-plugin.php:85:3 plugin_error_85 - Plugin error 85.'
		);
		expect( promptPayload ).not.toContain( 'omitted' );
		expect( promptPayload ).toContain( 'User request:\nFix the plugin.' );

		await applyDevelopmentProjectAiPatch( mockIpcMainInvokeEvent, project.id, {
			path: 'test-plugin.php',
			status: 'modified',
			beforeContent: '<?php',
			afterContent: '<?php echo "fixed";',
		} );
		await expect(
			getDevelopmentProjectValidationState( mockIpcMainInvokeEvent, project.id )
		).resolves.toEqual( { status: 'idle' } );
	} );

	it( 'validates readme headers and normalizes Plugin Check findings', async () => {
		await writeFixtureFile(
			'test-plugin.php',
			`<?php
/**
 * Plugin Name: Test Plugin
 * Version: 1.0.0
 * Tested up to: 6.8.3
 */`
		);
		const readmePath = await writeFixtureFile(
			'readme.txt',
			`=== Test Plugin ===
Stable tag: 1.0.0

== Description ==
Short description.`
		);
		await writeFixtureFile( 'assets/ignored.php', '<?php echo "ignored";' );
		await writeFixtureFile( '.studioignore', 'assets/ignored.php\n' );
		project = {
			...project,
			linkedSiteId: 'site-1',
			info: {
				...project.info!,
				readmePath,
			},
		};
		vi.mocked( listDevelopmentProjects ).mockResolvedValue( [ project ] );

		const executeWpCliCommand = vi
			.fn()
			.mockResolvedValueOnce( { exitCode: 0, stdout: '', stderr: '' } )
			.mockResolvedValueOnce( { exitCode: 0, stdout: 'Plugin activated.', stderr: '' } )
			.mockImplementationOnce( async () => {
				await expect(
					fs.readFile(
						path.join( testSiteDir, 'wp-content', 'plugins', 'test-plugin', 'readme.txt' ),
						'utf8'
					)
				).resolves.toContain( 'Test Plugin' );
				await expect(
					fs.stat(
						path.join(
							testSiteDir,
							'wp-content',
							'plugins',
							'test-plugin',
							'assets',
							'ignored.php'
						)
					)
				).rejects.toThrow();
				await expect(
					fs.stat(
						path.join( testSiteDir, 'wp-content', 'plugins', 'test-plugin', '.studioignore' )
					)
				).rejects.toThrow();

				return {
					exitCode: 1,
					stdout: JSON.stringify( [
						{
							file: '/wordpress/wp-content/plugins/test-plugin/test-plugin.php',
							line: 12,
							column: 3,
							type: 'ERROR',
							code: 'plugin_header_textdomain',
							message: 'Detected usage of $_POST[&#039;getpost-radio&#039;] without sanitization.',
						},
						{
							file: '/wordpress/wp-content/plugins/test-plugin/readme.txt',
							type: 'WARNING',
							code: 'readme_stable_tag',
							message: 'Stable tag should match the plugin version.',
						},
						{
							file: '/wordpress/wp-content/plugins/test-plugin/test-plugin.php',
							type: 'ERROR',
							code: 'mismatched_tested_up_to_header',
							message:
								'Mismatched "Tested up to": 6.8.1 != 6.8.3. The "Tested up to" value in the readme file must match the "Tested up to" value in the plugin header.',
						},
					] ),
					stderr: 'Deprecated: noisy Plugin Check output',
				};
			} );
		const linkedServer = {
			details: {
				id: 'site-1',
				name: 'Linked Site',
				path: testSiteDir,
				port: 8888,
				running: true,
				url: 'http://localhost:8888',
			},
			executeWpCliCommand,
			start: vi.fn(),
		} as unknown as SiteServer;
		vi.mocked( SiteServer.get ).mockImplementation( ( siteId ) =>
			siteId === 'site-1' ? linkedServer : undefined
		);

		const result = await runDevelopmentProjectValidation( mockIpcMainInvokeEvent, project.id );

		expect( executeWpCliCommand ).toHaveBeenNthCalledWith( 1, [
			'plugin',
			'is-installed',
			'plugin-check',
		] );
		expect( executeWpCliCommand ).toHaveBeenNthCalledWith( 2, [
			'plugin',
			'activate',
			'plugin-check',
		] );
		expect( executeWpCliCommand ).toHaveBeenNthCalledWith(
			3,
			expect.arrayContaining( [ 'plugin', 'check', 'test-plugin/test-plugin.php' ] )
		);
		await expect(
			fs.stat( path.join( testSiteDir, 'wp-content', 'plugins', 'test-plugin' ) )
		).rejects.toThrow();
		expect( result.pluginCheckAvailable ).toBe( true );
		expect( result.findings ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					source: 'readme',
					severity: 'warning',
					code: 'readme.missing_contributors',
					file: 'readme.txt',
				} ),
				expect.objectContaining( {
					source: 'plugin-check',
					severity: 'error',
					code: 'plugin_header_textdomain',
					file: 'test-plugin.php',
					line: 12,
					column: 3,
					message: "Detected usage of $_POST['getpost-radio'] without sanitization.",
				} ),
				expect.objectContaining( {
					source: 'plugin-check',
					severity: 'warning',
					code: 'readme_stable_tag',
					file: 'readme.txt',
					line: 2,
					column: 1,
				} ),
				expect.objectContaining( {
					source: 'plugin-check',
					severity: 'error',
					code: 'mismatched_tested_up_to_header',
					file: 'test-plugin.php',
					line: 5,
					column: 1,
				} ),
			] )
		);
		expect( result.summary.pluginCheck ).toBe( 3 );
		expect( result.summary.readme ).toBeGreaterThan( 0 );
		await expect(
			getDevelopmentProjectValidationState( mockIpcMainInvokeEvent, project.id )
		).resolves.toMatchObject( {
			status: 'completed',
			result,
		} );
	} );

	it( 'keeps validation marked as running while Plugin Check is still active', async () => {
		const readmePath = await writeFixtureFile(
			'readme.txt',
			`=== Test Plugin ===
Contributors: tester
Stable tag: 1.0.0

== Description ==
Short description.`
		);
		project = {
			...project,
			linkedSiteId: 'site-1',
			info: {
				...project.info!,
				readmePath,
			},
		};
		vi.mocked( listDevelopmentProjects ).mockResolvedValue( [ project ] );

		const pluginCheckResult = createDeferred< {
			exitCode: number;
			stdout: string;
			stderr: string;
		} >();
		const executeWpCliCommand = vi
			.fn()
			.mockResolvedValueOnce( { exitCode: 0, stdout: '', stderr: '' } )
			.mockResolvedValueOnce( { exitCode: 0, stdout: 'Plugin activated.', stderr: '' } )
			.mockImplementationOnce( () => pluginCheckResult.promise );
		const linkedServer = {
			details: {
				id: 'site-1',
				name: 'Linked Site',
				path: testSiteDir,
				port: 8888,
				running: true,
				url: 'http://localhost:8888',
			},
			executeWpCliCommand,
			start: vi.fn(),
		} as unknown as SiteServer;
		vi.mocked( SiteServer.get ).mockImplementation( ( siteId ) =>
			siteId === 'site-1' ? linkedServer : undefined
		);

		const validationPromise = runDevelopmentProjectValidation( mockIpcMainInvokeEvent, project.id );

		await expect(
			getDevelopmentProjectValidationState( mockIpcMainInvokeEvent, project.id )
		).resolves.toMatchObject( {
			status: 'running',
		} );

		pluginCheckResult.resolve( {
			exitCode: 0,
			stdout: '[]',
			stderr: '',
		} );

		const result = await validationPromise;
		expect( result.pluginCheckAvailable ).toBe( true );
		await expect(
			getDevelopmentProjectValidationState( mockIpcMainInvokeEvent, project.id )
		).resolves.toMatchObject( {
			status: 'completed',
			result,
		} );
	} );

	it( 'lists local and remote SVN tags with the current working copy ref', async () => {
		const { trunkDir, tagsDir } = await moveProjectIntoSvnCheckout();
		mockSvnSpawn( ( args ) => {
			if ( args[ 0 ] === 'info' && args[ 1 ] === trunkDir ) {
				return {
					stdout: 'URL: https://plugins.svn.wordpress.org/test-plugin/trunk\n',
				};
			}
			if ( args[ 0 ] === 'list' ) {
				return {
					stdout: '0.9.0/\n1.0.0/\n',
				};
			}
			return {};
		} );

		const result = await listDevelopmentProjectReleaseTags( mockIpcMainInvokeEvent, project.id );

		expect( result ).toMatchObject( {
			slug: 'test-plugin',
			svnRootDir: path.dirname( trunkDir ),
			currentRef: 'trunk',
			source: 'local',
			trunk: {
				name: 'trunk',
				path: trunkDir,
				isCurrent: true,
				isUncommitted: false,
				isTrunk: true,
			},
		} );
		expect( result.tags ).toEqual( [
			expect.objectContaining( {
				name: '0.9.0',
				isCurrent: false,
				isUncommitted: false,
			} ),
			expect.objectContaining( {
				name: '1.0.0',
				path: path.join( tagsDir, '1.0.0' ),
				isCurrent: false,
				isUncommitted: false,
			} ),
			expect.objectContaining( {
				name: '1.0.1',
				path: path.join( tagsDir, '1.0.1' ),
				isCurrent: false,
				isUncommitted: true,
			} ),
		] );
	} );

	it( 'switches the editable SVN working copy to a published tag', async () => {
		const { trunkDir } = await moveProjectIntoSvnCheckout();
		const calls: string[][] = [];
		let currentRef = 'trunk';
		const refreshedProject = {
			...project,
			updatedAt: '2026-06-23T01:00:00.000Z',
			info: {
				...project.info!,
				version: '1.0.0',
			},
		};
		vi.mocked( refreshDevelopmentProject ).mockResolvedValue( refreshedProject );
		mockSvnSpawn( ( args ) => {
			calls.push( args );
			if ( args[ 0 ] === 'info' && args[ 1 ] === trunkDir ) {
				return {
					stdout: `URL: https://plugins.svn.wordpress.org/test-plugin/${
						currentRef === 'trunk' ? 'trunk' : `tags/${ currentRef }`
					}\n`,
				};
			}
			if ( args[ 0 ] === 'info' && args[ 1 ].endsWith( '/tags/1.0.0' ) ) {
				return {
					stdout: 'Repository Root: https://plugins.svn.wordpress.org/test-plugin\n',
				};
			}
			if ( args[ 0 ] === 'status' ) {
				return { stdout: '' };
			}
			if ( args[ 0 ] === 'switch' ) {
				currentRef = '1.0.0';
				return { stdout: 'Updated to revision 123.\n' };
			}
			if ( args[ 0 ] === 'list' ) {
				return { stdout: '1.0.0/\n' };
			}
			return {};
		} );

		const result = await switchDevelopmentProjectReleaseTag(
			mockIpcMainInvokeEvent,
			project.id,
			'1.0.0'
		);

		expect( calls ).toContainEqual( [
			'switch',
			'--ignore-ancestry',
			'--non-interactive',
			'--accept',
			'theirs-conflict',
			'https://plugins.svn.wordpress.org/test-plugin/tags/1.0.0',
			trunkDir,
		] );
		expect( calls ).not.toContainEqual( [ 'revert', '--recursive', trunkDir ] );
		expect( result ).toMatchObject( {
			ref: '1.0.0',
			project: refreshedProject,
			tags: {
				currentRef: '1.0.0',
			},
		} );
		expect( result.tags.tags.find( ( tag ) => tag.name === '1.0.0' ) ).toMatchObject( {
			isCurrent: true,
			isUncommitted: false,
		} );
	} );

	it( 'refuses to switch to a local-only SVN tag', async () => {
		const { trunkDir } = await moveProjectIntoSvnCheckout();
		mockSvnSpawn( ( args ) => {
			if ( args[ 0 ] === 'info' && args[ 1 ] === trunkDir ) {
				return {
					stdout: 'URL: https://plugins.svn.wordpress.org/test-plugin/trunk\n',
				};
			}
			if ( args[ 0 ] === 'info' && args[ 1 ].endsWith( '/tags/1.0.1' ) ) {
				return { exitCode: 1, stderr: 'Not found\n' };
			}
			if ( args[ 0 ] === 'list' ) {
				return { stdout: '1.0.0/\n' };
			}
			return {};
		} );

		await expect(
			switchDevelopmentProjectReleaseTag( mockIpcMainInvokeEvent, project.id, '1.0.1' )
		).rejects.toThrow( 'exists locally but is not published on WordPress.org SVN yet' );
	} );

	it( 'starts a newly created Playground before returning it', async () => {
		const start = vi.fn().mockResolvedValue( undefined );
		const createdServer = {
			details: {
				id: 'site-new',
				name: 'Test Plugin Playground',
				path: testSiteDir,
				port: 8899,
				running: false,
			},
			server: {},
			start,
		} as unknown as SiteServer;
		vi.mocked( SiteServer.get ).mockReturnValue( undefined );
		vi.mocked( SiteServer.create ).mockResolvedValue( {
			server: createdServer,
			details: createdServer.details,
		} );
		vi.mocked( updateDevelopmentProjectLinkedSite ).mockResolvedValue( {
			...project,
			linkedSiteId: 'site-new',
		} );

		const result = await startDevelopmentProjectPlayground( mockIpcMainInvokeEvent, project.id, {
			wpVersion: 'latest',
			phpVersion: '8.4',
		} );

		expect( start ).toHaveBeenCalledWith( {
			mounts: [
				{
					hostPath: testDir,
					vfsPath: '/wordpress/wp-content/plugins/test-plugin',
				},
			],
			autoStart: false,
		} );
		expect( result ).toMatchObject( {
			project: expect.objectContaining( {
				linkedSiteId: 'site-new',
			} ),
			siteId: 'site-new',
			running: true,
			url: 'http://localhost:8899',
		} );
	} );
} );
