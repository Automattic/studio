import { fork, spawn, type ChildProcess } from 'child_process';
import { BrowserWindow, session, type IpcMainInvokeEvent, type Session } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAiSession as createAiSessionInStore } from '@studio/common/ai/sessions/store';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { decodeHtmlEntities } from '@studio/common/lib/html-entities';
import {
	bumpPluginProjectVersion,
	calculateDevelopmentProjectVersionState,
	compareVersions,
	discoverPluginProject,
} from '@studio/common/lib/plugin-projects';
import {
	addDevelopmentProject as addProjectToRegistry,
	listDevelopmentProjects as listProjectsFromRegistry,
	refreshDevelopmentProject as refreshProjectInRegistry,
	removeDevelopmentProject as removeProjectFromRegistry,
	updateDevelopmentProjectLinkedSite,
} from '@studio/common/lib/publishing-config';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import {
	getDevelopmentPlaygroundSitesDirectory,
	getDevelopmentProjectsDirectory,
} from '@studio/common/lib/well-known-paths';
import ignore from 'ignore';
import { WORDPRESS_ORG_AUTH_SESSION_PARTITION } from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { getAiSessionsRootDirectory } from 'src/lib/ai-sessions';
import * as oauthClient from 'src/lib/oauth';
import {
	buildAgentResumeArgs,
	getAgentRunForkOptions,
	writeInputPayloadFile,
} from 'src/modules/ai-agent/run-manager';
import {
	getSavedWordPressOrgAccount,
	getWordPressOrgLoginUserAgent,
} from 'src/modules/user-settings/lib/wordpress-org-auth';
import { SiteServer } from 'src/site-server';
import { getCliPath } from 'src/storage/paths';
import { loadDevelopmentProjectChatState, saveDevelopmentProjectChatState } from './chat-state';
import type { JsonEvent, TurnCompletedStatus } from '@studio/common/ai/json-events';
import type {
	DevelopmentProject,
	DevelopmentProjectAiPatch,
	DevelopmentProjectAiPatchResult,
	DevelopmentProjectAiReviewEvent,
	DevelopmentProjectAiReviewOptions,
	DevelopmentProjectAiReviewResult,
	DevelopmentProjectChatMessage,
	DevelopmentProjectChatState,
	DevelopmentProjectDirectory,
	DevelopmentProjectFile,
	DevelopmentProjectFileContent,
	DevelopmentProjectFilesResult,
	DevelopmentProjectValidationFinding,
	DevelopmentProjectValidationResult,
	DevelopmentProjectValidationState,
	DevelopmentProjectPlaygroundOptions,
	DevelopmentProjectPlaygroundResult,
	DevelopmentProjectReleaseTag,
	DevelopmentProjectReleaseTagList,
	DevelopmentProjectReleaseTagSwitchResult,
	DevelopmentProjectVersionBump,
	DevelopmentProjectVersionState,
	RemoteDevelopmentPlugin,
	RemoteDevelopmentPluginsResult,
	WordPressOrgPluginRole,
} from '@studio/common/types/publishing';
import type { Blueprint } from '@wp-playground/blueprints';

type ListedWordPressOrgPlugin = Omit<
	RemoteDevelopmentPlugin,
	'localState' | 'localProjectId' | 'localProjectSource' | 'localPath'
>;

type ArchivePageResult = {
	plugins: ListedWordPressOrgPlugin[];
	nextUrl?: string;
};

type RunningDevelopmentProjectValidationState = Extract<
	DevelopmentProjectValidationState,
	{ status: 'running' }
> & {
	promise: Promise< DevelopmentProjectValidationResult >;
};

type StoredDevelopmentProjectValidationState =
	| Exclude< DevelopmentProjectValidationState, { status: 'running' } >
	| RunningDevelopmentProjectValidationState;

const WORDPRESS_ORG_PLUGIN_ARCHIVE_PAGE_LIMIT = 20;
const WORDPRESS_ORG_PLUGIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SVN_OUTPUT_CAPTURE_BYTES = 80 * 1024;
const DEVELOPMENT_PROJECT_MAX_EDITABLE_FILES = 500;
const DEVELOPMENT_PROJECT_MAX_EDITABLE_FILE_SIZE = 1024 * 1024;
const DEVELOPMENT_PROJECT_MAX_PREVIEWABLE_FILE_SIZE = 10 * 1024 * 1024;
const DEVELOPMENT_PROJECT_AI_VALIDATION_FINDING_LIMIT = 80;
const DEVELOPMENT_PROJECT_IGNORE_FILE = '.studioignore';
const DEVELOPMENT_PROJECT_LEGACY_IGNORE_FILE = '.pressshipignore';
const DEVELOPMENT_PROJECT_EXCLUDED_DIRECTORIES = new Set( [
	'.git',
	'.svn',
	'.hg',
	'.idea',
	'.vscode',
	'node_modules',
	'vendor',
	'dist',
	'build',
	'coverage',
	'.next',
] );
const DEVELOPMENT_PROJECT_TEXT_EXTENSIONS = new Set( [
	'.css',
	'.csv',
	'.html',
	'.htm',
	'.ini',
	'.js',
	'.json',
	'.jsx',
	'.md',
	'.mjs',
	'.php',
	'.scss',
	'.sh',
	'.svg',
	'.ts',
	'.tsx',
	'.txt',
	'.xml',
	'.yaml',
	'.yml',
] );
const DEVELOPMENT_PROJECT_IMAGE_MEDIA_TYPES = new Map( [
	[ '.avif', 'image/avif' ],
	[ '.bmp', 'image/bmp' ],
	[ '.gif', 'image/gif' ],
	[ '.ico', 'image/x-icon' ],
	[ '.jpeg', 'image/jpeg' ],
	[ '.jpg', 'image/jpeg' ],
	[ '.png', 'image/png' ],
	[ '.svg', 'image/svg+xml' ],
	[ '.webp', 'image/webp' ],
] );
const DEVELOPMENT_PROJECT_AI_REVIEW_TEMP_PREFIX = 'studio-development-ai-review-';
const developmentProjectValidationStates = new Map<
	string,
	StoredDevelopmentProjectValidationState
>();

function nowIso(): string {
	return new Date().toISOString();
}

function clearDevelopmentProjectValidationState( projectId: string ) {
	developmentProjectValidationStates.delete( projectId );
}

const DEVELOPMENT_PLAYGROUND_MU_PLUGIN_PATH =
	'/wordpress/wp-content/mu-plugins/studio-plugin-development-playground.php';
const DEVELOPMENT_PLAYGROUND_MU_PLUGIN = `<?php
function studio_plugin_development_remove_frame_options_header() {
    remove_action('admin_init', 'send_frame_options_header');
    remove_action('login_init', 'send_frame_options_header');
    if (function_exists('header_remove')) {
        header_remove('X-Frame-Options');
    }
}

function studio_plugin_development_filter_playground_headers($headers) {
    unset($headers['X-Frame-Options']);
    unset($headers['x-frame-options']);
    return $headers;
}

add_filter('wp_headers', 'studio_plugin_development_filter_playground_headers');
add_action('init', 'studio_plugin_development_remove_frame_options_header', 0);
add_action('admin_init', 'studio_plugin_development_remove_frame_options_header', 0);
add_action('admin_init', 'studio_plugin_development_remove_frame_options_header', PHP_INT_MAX);
add_action('login_init', 'studio_plugin_development_remove_frame_options_header', 0);
add_action('login_init', 'studio_plugin_development_remove_frame_options_header', PHP_INT_MAX);
add_action('send_headers', 'studio_plugin_development_remove_frame_options_header', PHP_INT_MAX);
`;

function getWordPressOrgSession(): Session {
	return session.fromPartition( WORDPRESS_ORG_AUTH_SESSION_PARTITION );
}

function getAuthorArchiveUrl( username: string ): string {
	return `https://wordpress.org/plugins/author/${ encodeURIComponent( username ) }/`;
}

function normalizePluginUrl( value: string ): string {
	return new URL( value, 'https://wordpress.org' ).toString();
}

function normalizeRole( role: unknown ): WordPressOrgPluginRole | undefined {
	return role === 'committer' || role === 'contributor' ? role : undefined;
}

function normalizeListedPlugin( value: unknown ): ListedWordPressOrgPlugin | undefined {
	if ( ! value || typeof value !== 'object' ) {
		return undefined;
	}

	const plugin = value as Partial< ListedWordPressOrgPlugin >;
	if (
		typeof plugin.name !== 'string' ||
		typeof plugin.slug !== 'string' ||
		typeof plugin.url !== 'string' ||
		! WORDPRESS_ORG_PLUGIN_SLUG_PATTERN.test( plugin.slug )
	) {
		return undefined;
	}

	const roles = Array.isArray( plugin.roles )
		? plugin.roles
				.map( normalizeRole )
				.filter( ( role ): role is WordPressOrgPluginRole => Boolean( role ) )
		: [];

	return {
		name: plugin.name,
		slug: plugin.slug,
		url: normalizePluginUrl( plugin.url ),
		author: typeof plugin.author === 'string' ? plugin.author : undefined,
		activeInstalls: typeof plugin.activeInstalls === 'string' ? plugin.activeInstalls : undefined,
		testedWith: typeof plugin.testedWith === 'string' ? plugin.testedWith : undefined,
		roles: roles.length > 0 ? roles : [ 'contributor' ],
	};
}

function dedupeListedPlugins( plugins: ListedWordPressOrgPlugin[] ): ListedWordPressOrgPlugin[] {
	const pluginsBySlug = new Map< string, ListedWordPressOrgPlugin >();

	for ( const plugin of plugins ) {
		const existingPlugin = pluginsBySlug.get( plugin.slug );
		if ( ! existingPlugin ) {
			pluginsBySlug.set( plugin.slug, plugin );
			continue;
		}

		pluginsBySlug.set( plugin.slug, {
			...existingPlugin,
			...plugin,
			roles: Array.from( new Set( [ ...existingPlugin.roles, ...plugin.roles ] ) ),
		} );
	}

	return Array.from( pluginsBySlug.values() ).sort( ( firstPlugin, secondPlugin ) =>
		firstPlugin.name.localeCompare( secondPlugin.name )
	);
}

function getLocalState(
	plugin: ListedWordPressOrgPlugin,
	projects: DevelopmentProject[]
): Pick<
	RemoteDevelopmentPlugin,
	'localState' | 'localProjectId' | 'localProjectSource' | 'localPath'
> {
	const matches = projects.filter( ( project ) => project.slug === plugin.slug );
	const clonedProject = matches.find(
		( project ) => project.source === 'clone' && project.exists !== false
	);
	const trackedProject = matches.find( ( project ) => project.exists !== false );
	const missingProject = matches.find( ( project ) => project.exists === false );

	if ( clonedProject ) {
		return {
			localState: 'cloned',
			localProjectId: clonedProject.id,
			localProjectSource: clonedProject.source,
			localPath: clonedProject.path,
		};
	}

	if ( trackedProject ) {
		return {
			localState: 'tracked',
			localProjectId: trackedProject.id,
			localProjectSource: trackedProject.source,
			localPath: trackedProject.path,
		};
	}

	if ( missingProject ) {
		return {
			localState: 'missing',
			localPath: missingProject.path,
		};
	}

	return {
		localState: 'not-cloned',
	};
}

function getArchiveParseScript( username: string ): string {
	return `
		( () => {
			const username = ${ JSON.stringify( username.toLowerCase() ) };
			const cleanText = ( value ) => ( value?.textContent || '' ).replace( /\\s+/g, ' ' ).trim() || undefined;
			const cards = Array.from( document.querySelectorAll( 'li.type-plugin, article.plugin-card, .plugin-card' ) );
			const plugins = cards.map( ( card ) => {
				const link = card.querySelector( 'h3.entry-title a[href*="/plugins/"], .entry-title a[href*="/plugins/"], a[href*="/plugins/"]' );
				const href = link?.href;
				const slug = href?.match( /\\/plugins\\/([^/]+)\\// )?.[ 1 ];
				if ( ! slug ) {
					return null;
				}

				const classList = Array.from( card.classList ).map( ( className ) => className.toLowerCase() );
				const roles = [];
				if ( classList.includes( \`plugin_contributors-\${ username }\` ) ) {
					roles.push( 'contributor' );
				}
				if ( classList.includes( \`plugin_committers-\${ username }\` ) ) {
					roles.push( 'committer' );
				}

				return {
					name: cleanText( link ) || slug,
					slug,
					url: href,
					author: cleanText( card.querySelector( '.plugin-author span, .plugin-author' ) ),
					activeInstalls: cleanText( card.querySelector( '.active-installs span, .active-installs' ) ),
					testedWith: cleanText( card.querySelector( '.tested-with span, .tested-with' ) ),
					roles: roles.length > 0 ? roles : [ 'contributor' ],
				};
			} ).filter( Boolean );

			const nextLink = document.querySelector( 'a[rel~="next"], .nav-links a.next, a.next' );
			return {
				plugins,
				nextUrl: nextLink?.href,
			};
		} )()
	`;
}

async function readAuthorArchivePage(
	archiveWindow: BrowserWindow,
	url: string,
	username: string
): Promise< ArchivePageResult > {
	await archiveWindow.loadURL( url );
	const result = ( await archiveWindow.webContents.executeJavaScript(
		getArchiveParseScript( username ),
		true
	) ) as Partial< ArchivePageResult >;

	return {
		plugins: Array.isArray( result.plugins )
			? result.plugins
					.map( normalizeListedPlugin )
					.filter( ( plugin ): plugin is ListedWordPressOrgPlugin => Boolean( plugin ) )
			: [],
		nextUrl: typeof result.nextUrl === 'string' ? normalizePluginUrl( result.nextUrl ) : undefined,
	};
}

async function listLoggedInWordPressOrgPlugins(
	authSession: Session,
	username: string
): Promise< ListedWordPressOrgPlugin[] > {
	const archiveWindow = new BrowserWindow( {
		show: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			session: authSession,
		},
	} );
	archiveWindow.webContents.setUserAgent( getWordPressOrgLoginUserAgent() );
	archiveWindow.webContents.setWindowOpenHandler( () => ( { action: 'deny' } ) );

	const plugins: ListedWordPressOrgPlugin[] = [];
	let nextUrl: string | undefined = getAuthorArchiveUrl( username );

	try {
		for ( let page = 0; nextUrl && page < WORDPRESS_ORG_PLUGIN_ARCHIVE_PAGE_LIMIT; page += 1 ) {
			const pageResult = await readAuthorArchivePage( archiveWindow, nextUrl, username );
			plugins.push( ...pageResult.plugins );
			nextUrl = pageResult.nextUrl;
		}
	} finally {
		if ( ! archiveWindow.isDestroyed() ) {
			archiveWindow.close();
		}
	}

	return dedupeListedPlugins( plugins );
}

function assertWordPressOrgPluginSlug( slug: string ): void {
	if ( ! WORDPRESS_ORG_PLUGIN_SLUG_PATTERN.test( slug ) ) {
		throw new Error( 'Invalid WordPress.org plugin slug.' );
	}
}

function assertVersionBump( bump: string ): asserts bump is DevelopmentProjectVersionBump {
	if ( ! [ 'patch', 'minor', 'major' ].includes( bump ) ) {
		throw new Error( 'Invalid version bump.' );
	}
}

async function pathExists( targetPath: string ): Promise< boolean > {
	try {
		await fs.stat( targetPath );
		return true;
	} catch {
		return false;
	}
}

async function directoryIsEmpty( targetPath: string ): Promise< boolean > {
	const entries = await fs.readdir( targetPath );
	return entries.length === 0;
}

async function getSvnCloneAction( checkoutPath: string ): Promise< 'checkout' | 'update' > {
	if ( ! ( await pathExists( checkoutPath ) ) ) {
		return 'checkout';
	}

	if ( await pathExists( path.join( checkoutPath, '.svn' ) ) ) {
		return 'update';
	}

	if ( await directoryIsEmpty( checkoutPath ) ) {
		return 'checkout';
	}

	throw new Error(
		`Target directory already exists and is not an SVN working copy: ${ checkoutPath }`
	);
}

function runSvn( args: string[], cwd: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( 'svn', args, { cwd } );
		let output = '';

		const appendOutput = ( chunk: Buffer ) => {
			output += chunk.toString();
			if ( output.length > SVN_OUTPUT_CAPTURE_BYTES ) {
				output = output.slice( -SVN_OUTPUT_CAPTURE_BYTES );
			}
		};

		child.stdout?.on( 'data', appendOutput );
		child.stderr?.on( 'data', appendOutput );
		child.on( 'error', ( error: NodeJS.ErrnoException ) => {
			if ( error.code === 'ENOENT' ) {
				reject( new Error( 'Subversion (svn) is required to clone WordPress.org plugins.' ) );
				return;
			}
			reject( error );
		} );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve();
				return;
			}
			reject( new Error( output.trim() || `svn ${ args.join( ' ' ) } failed.` ) );
		} );
	} );
}

async function checkoutOrUpdatePlugin( slug: string, checkoutPath: string ): Promise< void > {
	const action = await getSvnCloneAction( checkoutPath );
	const pluginSvnUrl = `https://plugins.svn.wordpress.org/${ slug }`;

	if ( action === 'checkout' ) {
		await fs.mkdir( path.dirname( checkoutPath ), { recursive: true } );
		await runSvn( [ 'checkout', pluginSvnUrl, checkoutPath ], os.homedir() );
		return;
	}

	await runSvn( [ 'update' ], checkoutPath );
}

function getSiteUrl( details: SiteDetails ): string {
	if ( details.customDomain ) {
		const protocol = details.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ details.customDomain }`;
	}

	return `http://localhost:${ details.port }`;
}

function markServerRunning( server: SiteServer ): void {
	if ( server.details.running ) {
		return;
	}

	const url = getSiteUrl( server.details );
	server.details = {
		...server.details,
		running: true,
		url,
	};
	server.server.url = url;
}

function runSvnCapture( args: string[], cwd: string ): Promise< string | undefined > {
	return new Promise( ( resolve ) => {
		const child = spawn( 'svn', args, { cwd } );
		let stdout = '';

		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			stdout += chunk.toString();
		} );
		child.on( 'error', () => resolve( undefined ) );
		child.on( 'close', ( code ) => {
			resolve( code === 0 ? stdout : undefined );
		} );
	} );
}

function runSvnWithOutput( args: string[], cwd: string ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( 'svn', args, { cwd } );
		let output = '';

		const appendOutput = ( chunk: Buffer ) => {
			output += chunk.toString();
			if ( output.length > SVN_OUTPUT_CAPTURE_BYTES ) {
				output = output.slice( -SVN_OUTPUT_CAPTURE_BYTES );
			}
		};

		child.stdout?.on( 'data', appendOutput );
		child.stderr?.on( 'data', appendOutput );
		child.on( 'error', ( error: NodeJS.ErrnoException ) => {
			if ( error.code === 'ENOENT' ) {
				reject( new Error( 'Subversion (`svn`) is required for tag management.' ) );
				return;
			}
			reject( error );
		} );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve( output );
				return;
			}
			reject( new Error( output.trim() || `svn ${ args.join( ' ' ) } failed.` ) );
		} );
	} );
}

async function readRemotePluginVersion( slug: string ): Promise< string | undefined > {
	const requestUrl = new URL( 'https://api.wordpress.org/plugins/info/1.2/' );
	requestUrl.searchParams.set( 'action', 'plugin_information' );
	requestUrl.searchParams.set( 'request[slug]', slug );
	requestUrl.searchParams.set( 'request[fields][sections]', '0' );
	requestUrl.searchParams.set( 'request[fields][versions]', '0' );
	requestUrl.searchParams.set( 'request[fields][banners]', '0' );
	requestUrl.searchParams.set( 'request[fields][icons]', '0' );

	try {
		const response = await fetch( requestUrl );
		if ( ! response.ok ) {
			return undefined;
		}

		const plugin = ( await response.json() ) as { version?: unknown };
		return typeof plugin.version === 'string' ? plugin.version : undefined;
	} catch {
		return undefined;
	}
}

function getSvnRootDir( projectPath: string ): string | undefined {
	if ( path.basename( projectPath ) === 'trunk' ) {
		return path.dirname( projectPath );
	}

	return undefined;
}

async function readLocalSvnTags( projectPath: string ): Promise< string[] | undefined > {
	const svnRootDir = getSvnRootDir( projectPath );
	if ( ! svnRootDir ) {
		return undefined;
	}

	const tagsPath = path.join( svnRootDir, 'tags' );
	if ( ! ( await pathExists( tagsPath ) ) ) {
		return undefined;
	}

	const entries = await fs.readdir( tagsPath, { withFileTypes: true } );
	return entries
		.filter( ( entry ) => entry.isDirectory() )
		.map( ( entry ) => entry.name )
		.sort( compareVersions );
}

async function readRemoteSvnTags( slug: string ): Promise< string[] | undefined > {
	const stdout = await runSvnCapture(
		[ 'list', `https://plugins.svn.wordpress.org/${ slug }/tags` ],
		os.homedir()
	);
	return stdout
		?.split( /\r?\n/ )
		.map( ( line ) => line.replace( /\/$/, '' ).trim() )
		.filter( Boolean )
		.sort( compareVersions );
}

async function remoteSvnTagExists( slug: string, tagName: string ): Promise< boolean > {
	const stdout = await runSvnCapture(
		[ 'info', `https://plugins.svn.wordpress.org/${ slug }/tags/${ tagName }` ],
		os.homedir()
	);
	return stdout !== undefined;
}

async function readCurrentSvnRef(
	rootDir: string,
	svnRootDir?: string
): Promise< string | undefined > {
	if ( ! svnRootDir ) {
		return undefined;
	}

	const stdout = await runSvnCapture( [ 'info', rootDir ], svnRootDir );
	const url = stdout?.match( /^URL:\s*(.+)$/im )?.[ 1 ]?.trim();
	if ( ! url ) {
		return undefined;
	}

	const tagMatch = url.match( /\/tags\/([^/]+)\/?$/ );
	if ( tagMatch ) {
		return tagMatch[ 1 ];
	}

	if ( /\/trunk\/?$/.test( url ) ) {
		return 'trunk';
	}

	return undefined;
}

async function readLocalReleaseTagFolders(
	svnRootDir?: string
): Promise< Array< { name: string; path: string } > > {
	if ( ! svnRootDir ) {
		return [];
	}

	const tagsPath = path.join( svnRootDir, 'tags' );
	if ( ! ( await pathExists( tagsPath ) ) ) {
		return [];
	}

	const entries = await fs.readdir( tagsPath, { withFileTypes: true } );
	return entries
		.filter( ( entry ) => entry.isDirectory() && entry.name !== '.svn' )
		.map( ( entry ) => ( {
			name: entry.name,
			path: path.join( tagsPath, entry.name ),
		} ) );
}

async function listReleaseTagsForProject(
	project: DevelopmentProject
): Promise< DevelopmentProjectReleaseTagList > {
	const rootDir = project.info?.rootDir || project.path;
	const slug = project.info?.slug || project.slug;
	const svnRootDir = getSvnRootDir( rootDir );
	const [ currentRef, localTags, remoteTags ] = await Promise.all( [
		readCurrentSvnRef( rootDir, svnRootDir ),
		readLocalReleaseTagFolders( svnRootDir ),
		readRemoteSvnTags( slug ),
	] );
	const remoteTagNames = remoteTags ?? [];
	const trunk: DevelopmentProjectReleaseTag | undefined = svnRootDir
		? {
				name: 'trunk',
				path: path.join( svnRootDir, 'trunk' ),
				isCurrent: currentRef === 'trunk' || currentRef === undefined,
				isUncommitted: false,
				isTrunk: true,
		  }
		: undefined;
	const tags = Array.from(
		new Set( [ ...localTags.map( ( entry ) => entry.name ), ...remoteTagNames ] )
	)
		.filter( ( tagName ) => tagName && tagName !== 'trunk' )
		.map( ( tagName ) => {
			const localTag = localTags.find( ( entry ) => entry.name === tagName );
			const remoteHasTag = remoteTagNames.includes( tagName );
			return {
				name: tagName,
				path: localTag?.path,
				isCurrent: currentRef === tagName,
				isUncommitted: Boolean( localTag ) && ! remoteHasTag,
			};
		} )
		.sort( ( firstTag, secondTag ) => compareVersions( firstTag.name, secondTag.name ) );

	return {
		slug,
		svnRootDir,
		currentRef,
		trunk,
		tags,
		source: svnRootDir ? 'local' : remoteTags ? 'remote' : 'unknown',
	};
}

function assertReleaseTagName( tagName: string ): void {
	if ( tagName === 'trunk' ) {
		return;
	}
	if ( ! /^[A-Za-z0-9_.+-]+$/.test( tagName ) ) {
		throw new Error(
			'Tag name may only contain letters, numbers, dots, underscores, hyphens, and pluses.'
		);
	}
}

async function switchReleaseTagForProject(
	project: DevelopmentProject,
	tagNameInput: string
): Promise< string > {
	const tagName = tagNameInput.trim();
	if ( ! tagName ) {
		throw new Error( 'Tag name is required.' );
	}
	assertReleaseTagName( tagName );

	const rootDir = project.info?.rootDir || project.path;
	const slug = project.info?.slug || project.slug;
	const svnRootDir = getSvnRootDir( rootDir );
	if ( ! svnRootDir ) {
		throw new Error(
			'Switching tags requires a local WordPress.org SVN checkout. Clone the plugin first.'
		);
	}
	if ( ! ( await pathExists( rootDir ) ) ) {
		throw new Error( `Working copy ${ rootDir } does not exist on disk.` );
	}

	if ( tagName !== 'trunk' ) {
		const localTagPath = path.join( svnRootDir, 'tags', tagName );
		const localTagExists = await pathExists( localTagPath );
		const remoteTagReady = await remoteSvnTagExists( slug, tagName );
		if ( localTagExists && ! remoteTagReady ) {
			throw new Error(
				`Tag ${ tagName } exists locally but is not published on WordPress.org SVN yet. Run a release dry run to publish it; switching is only available for published tags.`
			);
		}
		if ( ! localTagExists && ! remoteTagReady ) {
			throw new Error(
				`Tag ${ tagName } does not exist locally or on WordPress.org SVN. Create it first.`
			);
		}
	}

	const refUrl =
		tagName === 'trunk'
			? `https://plugins.svn.wordpress.org/${ slug }/trunk`
			: `https://plugins.svn.wordpress.org/${ slug }/tags/${ tagName }`;

	const status = await runSvnWithOutput( [ 'status', rootDir ], svnRootDir );
	if ( status.trim() ) {
		await runSvnWithOutput( [ 'revert', '--recursive', rootDir ], svnRootDir );
	}
	await runSvnWithOutput(
		[
			'switch',
			'--ignore-ancestry',
			'--non-interactive',
			'--accept',
			'theirs-conflict',
			refUrl,
			rootDir,
		],
		svnRootDir
	);

	return tagName;
}

async function readSvnTags(
	slug: string,
	projectPath: string
): Promise< { tags?: string[]; source: DevelopmentProjectVersionState[ 'svnTagsSource' ] } > {
	const remoteTags = await readRemoteSvnTags( slug );
	if ( remoteTags ) {
		return { tags: remoteTags, source: 'remote' };
	}

	const localTags = await readLocalSvnTags( projectPath );
	if ( localTags ) {
		return { tags: localTags, source: 'local' };
	}

	return { source: 'unknown' };
}

async function getDevelopmentProjectOrThrow( projectId: string ): Promise< DevelopmentProject > {
	const project = ( await listProjectsFromRegistry() ).find( ( item ) => item.id === projectId );
	if ( ! project ) {
		throw new Error( 'Project not found.' );
	}
	if ( ! project.exists || ! project.info || project.error ) {
		throw new Error( project.error || 'Project is not available.' );
	}
	return project;
}

function normalizeDevelopmentProjectRelativePath( relativePath: string ): string {
	return relativePath.replace( /\\/g, '/' ).replace( /^\/+/, '' );
}

function getDevelopmentProjectSafePathFromRoot( rootDir: string, relativePath: string ): string {
	const normalizedPath = normalizeDevelopmentProjectRelativePath( relativePath );
	const projectRoot = path.resolve( rootDir );
	const targetPath = path.resolve( projectRoot, normalizedPath );

	if ( targetPath !== projectRoot && ! targetPath.startsWith( `${ projectRoot }${ path.sep }` ) ) {
		throw new Error( 'File path is outside the plugin project.' );
	}

	return targetPath;
}

function getDevelopmentProjectSafePath(
	project: DevelopmentProject,
	relativePath: string
): string {
	return getDevelopmentProjectSafePathFromRoot(
		project.info?.rootDir || project.path,
		relativePath
	);
}

function getDevelopmentProjectRelativePath( rootDir: string, targetPath: string ): string {
	return path.relative( rootDir, targetPath ).split( path.sep ).join( '/' );
}

function isAllowedDevelopmentProjectDotfile( name: string ): boolean {
	return [
		'.gitignore',
		DEVELOPMENT_PROJECT_IGNORE_FILE,
		DEVELOPMENT_PROJECT_LEGACY_IGNORE_FILE,
		'.editorconfig',
	].includes( name );
}

function splitIgnoreLines( content: string ): string[] {
	const normalized = content.replace( /^\uFEFF/, '' ).replace( /\r\n/g, '\n' );
	if ( ! normalized ) {
		return [];
	}
	return normalized.endsWith( '\n' )
		? normalized.slice( 0, -1 ).split( '\n' )
		: normalized.split( '\n' );
}

function normalizeDirectoryDotPattern( pattern: string ): string {
	const negated = pattern.startsWith( '!' );
	const pathPart = negated ? pattern.slice( 1 ) : pattern;
	if ( ! pathPart.endsWith( '/.' ) ) {
		return pattern;
	}
	const normalized = `${ pathPart.slice( 0, -2 ) }/**`;
	return negated ? `!${ normalized }` : normalized;
}

function normalizeExistingIgnorePattern( line: string ): string | undefined {
	const trimmed = line.trim();
	if ( ! trimmed || trimmed.startsWith( '#' ) ) {
		return undefined;
	}
	return normalizeDirectoryDotPattern( trimmed.replace( /\\/g, '/' ).replace( /^\.\//, '' ) );
}

function normalizeDevelopmentProjectIgnorePattern( input: string ): string {
	const pattern = normalizeDirectoryDotPattern(
		input.trim().replace( /\\/g, '/' ).replace( /^\.\//, '' )
	);

	if ( ! pattern ) {
		throw new Error( 'Enter an ignore pattern first.' );
	}
	if ( pattern.startsWith( '#' ) ) {
		throw new Error( 'Ignore patterns cannot start with #.' );
	}
	if ( pattern.startsWith( '!' ) ) {
		throw new Error( 'Negated patterns can be edited directly in .studioignore.' );
	}
	if ( pattern.includes( '\0' ) || /[\r\n]/.test( pattern ) ) {
		throw new Error( 'Ignore patterns must be a single line.' );
	}
	if ( pattern.startsWith( '/' ) || /^[A-Za-z]:/.test( pattern ) ) {
		throw new Error( 'Ignore patterns must be relative to the plugin directory.' );
	}
	if ( pattern.split( '/' ).some( ( segment ) => segment === '..' ) ) {
		throw new Error( 'Ignore patterns cannot contain parent-directory segments.' );
	}

	return pattern;
}

async function getDevelopmentProjectIgnoreFilePath( rootDir: string ): Promise< string > {
	const ignorePath = path.join( rootDir, DEVELOPMENT_PROJECT_IGNORE_FILE );
	if ( await pathExists( ignorePath ) ) {
		return ignorePath;
	}

	const legacyIgnorePath = path.join( rootDir, DEVELOPMENT_PROJECT_LEGACY_IGNORE_FILE );
	if ( ! ( await pathExists( legacyIgnorePath ) ) ) {
		return ignorePath;
	}

	try {
		await fs.rename( legacyIgnorePath, ignorePath );
	} catch ( error ) {
		if ( ! ( await pathExists( ignorePath ) ) ) {
			throw error;
		}
	}

	return ignorePath;
}

async function readDevelopmentProjectIgnorePatterns( rootDir: string ): Promise< string[] > {
	const ignorePath = await getDevelopmentProjectIgnoreFilePath( rootDir );
	if ( ! ( await pathExists( ignorePath ) ) ) {
		return [];
	}
	const content = await fs.readFile( ignorePath, 'utf8' );
	return splitIgnoreLines( content )
		.map( normalizeExistingIgnorePattern )
		.filter( ( pattern ): pattern is string => Boolean( pattern ) );
}

async function addDevelopmentProjectIgnorePatternToDisk(
	rootDir: string,
	input: string
): Promise< string[] > {
	const pattern = normalizeDevelopmentProjectIgnorePattern( input );
	const ignorePath = await getDevelopmentProjectIgnoreFilePath( rootDir );
	const existing = ( await pathExists( ignorePath ) )
		? await fs.readFile( ignorePath, 'utf8' )
		: '';
	const lines = splitIgnoreLines( existing );
	const patterns = lines
		.map( normalizeExistingIgnorePattern )
		.filter( ( item ): item is string => Boolean( item ) );

	if ( ! patterns.includes( pattern ) ) {
		const nextLines = [ ...lines ];
		while ( nextLines.length && nextLines[ nextLines.length - 1 ] === '' ) {
			nextLines.pop();
		}
		nextLines.push( pattern );
		await fs.mkdir( path.dirname( ignorePath ), { recursive: true } );
		await fs.writeFile( ignorePath, `${ nextLines.join( '\n' ) }\n`, 'utf8' );
	}

	return readDevelopmentProjectIgnorePatterns( rootDir );
}

async function removeDevelopmentProjectIgnorePatternFromDisk(
	rootDir: string,
	input: string
): Promise< string[] > {
	const pattern = normalizeDevelopmentProjectIgnorePattern( input );
	const ignorePath = await getDevelopmentProjectIgnoreFilePath( rootDir );

	if ( ! ( await pathExists( ignorePath ) ) ) {
		return [];
	}

	const existing = await fs.readFile( ignorePath, 'utf8' );
	const nextLines = splitIgnoreLines( existing ).filter(
		( line ) => normalizeExistingIgnorePattern( line ) !== pattern
	);

	while ( nextLines.length && nextLines[ nextLines.length - 1 ] === '' ) {
		nextLines.pop();
	}

	if ( nextLines.length === 0 ) {
		await fs.rm( ignorePath, { force: true } );
		return [];
	}

	await fs.writeFile( ignorePath, `${ nextLines.join( '\n' ) }\n`, 'utf8' );
	return readDevelopmentProjectIgnorePatterns( rootDir );
}

function createDevelopmentProjectIgnoreMatcher( patterns: string[] ): {
	ignores: ( relativePath: string ) => boolean;
	ignoredBy: ( relativePath: string ) => string | undefined;
	ignoredDirectoryBy: ( relativePath: string ) => string | undefined;
} {
	const safePatterns = patterns.filter( Boolean );
	const matcher = ignore().add( safePatterns );
	const positivePatterns = safePatterns.filter( ( pattern ) => ! pattern.trim().startsWith( '!' ) );
	const normalizePath = ( relativePath: string ) =>
		relativePath.replace( /\\/g, '/' ).replace( /^\.\//, '' );
	const getPositivePatternForPath = ( normalizedPath: string ) =>
		positivePatterns.find( ( pattern ) => ignore().add( pattern ).ignores( normalizedPath ) );

	return {
		ignores( relativePath: string ) {
			const normalizedPath = normalizePath( relativePath );
			return Boolean( normalizedPath && matcher.ignores( normalizedPath ) );
		},
		ignoredBy( relativePath: string ) {
			const normalizedPath = normalizePath( relativePath );
			if ( ! normalizedPath || ! matcher.ignores( normalizedPath ) ) {
				return undefined;
			}
			return getPositivePatternForPath( normalizedPath );
		},
		ignoredDirectoryBy( relativePath: string ) {
			const normalizedPath = normalizePath( relativePath ).replace( /\/$/, '' );
			if ( ! normalizedPath ) {
				return undefined;
			}

			const directPattern =
				getPositivePatternForPath( normalizedPath ) ||
				getPositivePatternForPath( `${ normalizedPath }/` );
			if ( directPattern ) {
				return directPattern;
			}

			return positivePatterns.find( ( pattern ) => {
				const normalizedPattern = normalizePath( pattern ).replace( /^\//, '' );
				return (
					normalizedPattern === `${ normalizedPath }/**` ||
					normalizedPattern === `${ normalizedPath }/*`
				);
			} );
		},
	};
}

function shouldIncludeDevelopmentProjectPath( rootDir: string, targetPath: string ): boolean {
	const relativePath = getDevelopmentProjectRelativePath( path.resolve( rootDir ), targetPath );
	if ( ! relativePath ) {
		return true;
	}

	return relativePath.split( '/' ).every( ( segment ) => {
		if ( DEVELOPMENT_PROJECT_EXCLUDED_DIRECTORIES.has( segment ) ) {
			return false;
		}
		if ( segment.startsWith( '.' ) && ! isAllowedDevelopmentProjectDotfile( segment ) ) {
			return false;
		}
		return true;
	} );
}

function shouldCopyDevelopmentProjectPathForValidation(
	rootDir: string,
	targetPath: string,
	ignoreMatcher: ReturnType< typeof createDevelopmentProjectIgnoreMatcher >
): boolean {
	if ( ! shouldIncludeDevelopmentProjectPath( rootDir, targetPath ) ) {
		return false;
	}

	const relativePath = getDevelopmentProjectRelativePath( path.resolve( rootDir ), targetPath );
	if ( ! relativePath ) {
		return true;
	}

	if (
		relativePath === DEVELOPMENT_PROJECT_IGNORE_FILE ||
		relativePath === DEVELOPMENT_PROJECT_LEGACY_IGNORE_FILE
	) {
		return false;
	}

	return (
		! ignoreMatcher.ignores( relativePath ) && ! ignoreMatcher.ignoredDirectoryBy( relativePath )
	);
}

type DevelopmentProjectFileDescriptor = Pick<
	DevelopmentProjectFile,
	'fileKind' | 'mediaType' | 'editable' | 'previewable'
>;

function getDevelopmentProjectFileDescriptor(
	filePath: string,
	size: number
): DevelopmentProjectFileDescriptor | undefined {
	const extension = path.extname( filePath ).toLowerCase();
	const mediaType = DEVELOPMENT_PROJECT_IMAGE_MEDIA_TYPES.get( extension );

	if ( mediaType ) {
		if ( size > DEVELOPMENT_PROJECT_MAX_PREVIEWABLE_FILE_SIZE ) {
			return undefined;
		}

		return {
			fileKind: 'image',
			mediaType,
			editable: extension === '.svg' && size <= DEVELOPMENT_PROJECT_MAX_EDITABLE_FILE_SIZE,
			previewable: true,
		};
	}

	const basename = path.basename( filePath ).toLowerCase();
	const isTextFile =
		isAllowedDevelopmentProjectDotfile( basename ) ||
		DEVELOPMENT_PROJECT_TEXT_EXTENSIONS.has( extension );

	if ( ! isTextFile || size > DEVELOPMENT_PROJECT_MAX_EDITABLE_FILE_SIZE ) {
		return undefined;
	}

	return {
		fileKind: 'text',
		editable: true,
		previewable: false,
	};
}

function createDevelopmentProjectPreviewDataUrl( mediaType: string, content: Buffer | string ) {
	if ( typeof content === 'string' && mediaType === 'image/svg+xml' ) {
		return `data:${ mediaType };charset=utf-8,${ encodeURIComponent( content ) }`;
	}

	const buffer = typeof content === 'string' ? Buffer.from( content, 'utf8' ) : content;
	return `data:${ mediaType };base64,${ buffer.toString( 'base64' ) }`;
}

async function listDevelopmentProjectFilesFromRoot(
	rootDirInput: string
): Promise< DevelopmentProjectFilesResult > {
	const rootDir = path.resolve( rootDirInput );
	const ignoreMatcher = createDevelopmentProjectIgnoreMatcher(
		await readDevelopmentProjectIgnorePatterns( rootDir )
	);
	const files: DevelopmentProjectFile[] = [];
	const directories: DevelopmentProjectDirectory[] = [];
	let truncated = false;

	const visitDirectory = async ( directoryPath: string ) => {
		if ( truncated ) {
			return;
		}

		const entries = await fs.readdir( directoryPath, { withFileTypes: true } );
		entries.sort( ( firstEntry, secondEntry ) => {
			if ( firstEntry.isDirectory() !== secondEntry.isDirectory() ) {
				return firstEntry.isDirectory() ? -1 : 1;
			}
			return firstEntry.name.localeCompare( secondEntry.name );
		} );

		for ( const entry of entries ) {
			if ( truncated ) {
				break;
			}

			if ( entry.name.startsWith( '.' ) && ! isAllowedDevelopmentProjectDotfile( entry.name ) ) {
				continue;
			}

			const entryPath = path.join( directoryPath, entry.name );
			const relativePath = getDevelopmentProjectRelativePath( rootDir, entryPath );

			if ( entry.isDirectory() ) {
				if ( DEVELOPMENT_PROJECT_EXCLUDED_DIRECTORIES.has( entry.name ) ) {
					continue;
				}

				const ignoredBy = ignoreMatcher.ignoredDirectoryBy( relativePath );
				directories.push( {
					path: relativePath,
					name: entry.name,
					parent: relativePath.includes( '/' )
						? relativePath.split( '/' ).slice( 0, -1 ).join( '/' )
						: '',
					ignored: Boolean( ignoredBy ),
					ignoredBy,
				} );
				await visitDirectory( entryPath );
				continue;
			}

			if ( ! entry.isFile() ) {
				continue;
			}

			const stats = await fs.stat( entryPath );
			const descriptor = getDevelopmentProjectFileDescriptor( entryPath, stats.size );
			if ( ! descriptor ) {
				continue;
			}

			files.push( {
				path: relativePath,
				name: entry.name,
				directory: relativePath.includes( '/' )
					? relativePath.split( '/' ).slice( 0, -1 ).join( '/' )
					: '',
				size: stats.size,
				extension: path.extname( entry.name ).replace( /^\./, '' ) || undefined,
				fileKind: descriptor.fileKind,
				mediaType: descriptor.mediaType,
				editable: descriptor.editable,
				previewable: descriptor.previewable,
				ignored: ignoreMatcher.ignores( relativePath ),
				ignoredBy: ignoreMatcher.ignoredBy( relativePath ),
			} );

			if ( files.length >= DEVELOPMENT_PROJECT_MAX_EDITABLE_FILES ) {
				truncated = true;
			}
		}
	};

	await visitDirectory( rootDir );

	return { files, directories, truncated };
}

async function listDevelopmentProjectFilesFromDisk(
	project: DevelopmentProject
): Promise< DevelopmentProjectFilesResult > {
	return listDevelopmentProjectFilesFromRoot( project.info?.rootDir || project.path );
}

async function readDevelopmentProjectEditableFiles(
	rootDir: string
): Promise< Map< string, string > > {
	const { files } = await listDevelopmentProjectFilesFromRoot( rootDir );
	const entries = await Promise.all(
		files
			.filter( ( file ) => file.editable )
			.map( async ( file ) => {
				const filePath = getDevelopmentProjectSafePathFromRoot( rootDir, file.path );
				return [ file.path, await fs.readFile( filePath, 'utf8' ) ] as const;
			} )
	);
	return new Map( entries );
}

async function collectDevelopmentProjectAiPatches(
	originalRootDir: string,
	updatedRootDir: string
): Promise< DevelopmentProjectAiPatch[] > {
	const [ originalFiles, updatedFiles ] = await Promise.all( [
		readDevelopmentProjectEditableFiles( originalRootDir ),
		readDevelopmentProjectEditableFiles( updatedRootDir ),
	] );
	const allPaths = Array.from(
		new Set( [ ...originalFiles.keys(), ...updatedFiles.keys() ] )
	).sort( ( firstPath, secondPath ) => firstPath.localeCompare( secondPath ) );
	const patches: DevelopmentProjectAiPatch[] = [];

	for ( const filePath of allPaths ) {
		const beforeContent = originalFiles.get( filePath );
		const afterContent = updatedFiles.get( filePath );

		if ( beforeContent === afterContent ) {
			continue;
		}

		if ( beforeContent === undefined ) {
			patches.push( {
				path: filePath,
				status: 'created',
				afterContent: afterContent ?? '',
			} );
			continue;
		}

		if ( afterContent === undefined ) {
			patches.push( {
				path: filePath,
				status: 'deleted',
				beforeContent,
			} );
			continue;
		}

		patches.push( {
			path: filePath,
			status: 'modified',
			beforeContent,
			afterContent,
		} );
	}

	return patches;
}

function chooseAiReviewQuestionAnswer(
	options: Array< { label: string; description: string } >
): string | undefined {
	return (
		options.find( ( option ) =>
			/allow|approve|accept|continue|yes/i.test( `${ option.label } ${ option.description }` )
		) ?? options[ 0 ]
	)?.label;
}

function sendAiReviewEventToRenderer(
	window: BrowserWindow | null,
	projectId: string,
	sessionId: string,
	event: DevelopmentProjectAiReviewEvent[ 'event' ]
): void {
	sendIpcEventToRendererWithWindow( window, 'development-project-ai-review-event', {
		projectId,
		sessionId,
		event,
	} );
}

function formatValidationFindingLocation( finding: DevelopmentProjectValidationFinding ): string {
	const locationParts = [
		finding.file || 'project',
		finding.line ? `:${ finding.line }` : '',
		finding.column ? `:${ finding.column }` : '',
	];
	return locationParts.join( '' );
}

function formatPluginCheckFindingsForAiReview(
	validationResult: DevelopmentProjectValidationResult | undefined,
	options: { includeAllFindings?: boolean } = {}
): string[] {
	if ( ! validationResult ) {
		return [];
	}

	const pluginCheckFindings = validationResult.findings
		.filter( ( finding ) => finding.source === 'plugin-check' )
		.sort( ( firstFinding, secondFinding ) => {
			const severityOrder = { error: 0, warning: 1, info: 2 };
			const severityDifference =
				severityOrder[ firstFinding.severity ] - severityOrder[ secondFinding.severity ];
			if ( severityDifference !== 0 ) {
				return severityDifference;
			}
			return formatValidationFindingLocation( firstFinding ).localeCompare(
				formatValidationFindingLocation( secondFinding )
			);
		} );

	if ( pluginCheckFindings.length === 0 ) {
		return [];
	}

	const visibleFindings = options.includeAllFindings
		? pluginCheckFindings
		: pluginCheckFindings.slice( 0, DEVELOPMENT_PROJECT_AI_VALIDATION_FINDING_LIMIT );
	const lines = [
		'Current Plugin Check findings:',
		`Summary: ${ validationResult.summary.error } errors, ${ validationResult.summary.warning } warnings, ${ validationResult.summary.info } info. Plugin Check findings: ${ validationResult.summary.pluginCheck }.`,
		`Checked at: ${ validationResult.checkedAt }`,
		options.includeAllFindings
			? 'Use this complete Plugin Check finding list as the validation context for the request. Fix every listed Plugin Check error or warning that can be fixed safely, prioritize errors first, keep behavior unchanged, and prefer targeted edits.'
			: 'Use these findings as the validation context for the request. Prioritize errors first, keep behavior unchanged, and prefer targeted edits.',
		'',
		...visibleFindings.map( ( finding, index ) => {
			const code = finding.code ? ` ${ finding.code }` : '';
			return `${ index + 1 }. [${ finding.severity }] ${ formatValidationFindingLocation(
				finding
			) }${ code } - ${ finding.message }`;
		} ),
	];

	if ( pluginCheckFindings.length > visibleFindings.length ) {
		lines.push(
			`...${
				pluginCheckFindings.length - visibleFindings.length
			} more Plugin Check finding(s) omitted.`
		);
	}

	return lines;
}

function createAiReviewPrompt(
	project: DevelopmentProject,
	options: DevelopmentProjectAiReviewOptions,
	tempProjectRoot: string,
	validationResult?: DevelopmentProjectValidationResult
): string {
	const selectedPath = normalizeDevelopmentProjectRelativePath( options.selectedPath || '' );
	const selectedFileLine = selectedPath
		? `Selected file: ${ selectedPath }\n`
		: 'Selected file: none\n';
	const pluginCheckLines = formatPluginCheckFindingsForAiReview( validationResult, {
		includeAllFindings: options.includeAllPluginCheckFindings,
	} );

	return [
		'You are helping inside WordPress Studio plugin development.',
		'Studio copied the plugin into a temporary workspace. Edit only files inside that workspace.',
		'Do not publish, commit, tag, run release commands, or modify files outside the active workspace.',
		'Prefer direct file edits over explanation. Studio will compare the temporary workspace with the original project and show the user Accept / Reject controls before any real project files change.',
		'',
		`Plugin: ${ project.name }`,
		`Slug: ${ project.slug }`,
		`Temporary workspace: ${ tempProjectRoot }`,
		selectedFileLine.trimEnd(),
		'',
		...pluginCheckLines,
		...( pluginCheckLines.length > 0 ? [ '' ] : [] ),
		'User request:',
		options.prompt.trim(),
	].join( '\n' );
}

async function copyDevelopmentProjectForAiReview(
	project: DevelopmentProject
): Promise< { tempRootDir: string; tempProjectRoot: string } > {
	const projectRoot = path.resolve( project.info?.rootDir || project.path );
	const tempRootDir = await fs.mkdtemp(
		path.join( os.tmpdir(), DEVELOPMENT_PROJECT_AI_REVIEW_TEMP_PREFIX )
	);
	const tempProjectRoot = path.join(
		tempRootDir,
		sanitizeFolderName( project.slug || project.name ) || 'project'
	);

	await fs.cp( projectRoot, tempProjectRoot, {
		recursive: true,
		preserveTimestamps: true,
		filter: ( sourcePath ) => shouldIncludeDevelopmentProjectPath( projectRoot, sourcePath ),
	} );

	return { tempRootDir, tempProjectRoot };
}

function runAiReviewCliTurn( options: {
	projectId: string;
	sessionId: string;
	prompt: string;
	displayMessage: string;
	workspacePath: string;
	workspaceName: string;
	window: BrowserWindow | null;
} ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		let lastErrorMessage: string | undefined;
		let turnStatus: TurnCompletedStatus | undefined;
		let settled = false;
		let inputPayload: { dir: string; path: string } | undefined;
		let child: ChildProcess | undefined;

		const cleanupAndSettle = async ( callback: () => void ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			if ( inputPayload ) {
				await fs.rm( inputPayload.dir, { recursive: true, force: true } ).catch( () => undefined );
			}
			callback();
		};

		try {
			inputPayload = writeInputPayloadFile( {
				prompt: options.prompt,
				displayMessage: options.displayMessage,
			} );
			child = fork(
				getCliPath(),
				buildAgentResumeArgs( {
					sessionId: options.sessionId,
					prompt: options.prompt,
					displayMessage: options.displayMessage,
					inputPayloadPath: inputPayload.path,
					workspacePath: options.workspacePath,
					workspaceName: options.workspaceName,
				} ),
				getAgentRunForkOptions()
			);
		} catch ( error ) {
			void cleanupAndSettle( () => reject( error ) );
			return;
		}

		child.on( 'spawn', () => {
			sendAiReviewEventToRenderer( options.window, options.projectId, options.sessionId, {
				type: 'run.started',
				timestamp: nowIso(),
			} );
		} );

		child.on( 'message', ( message ) => {
			if ( ! message || typeof message !== 'object' || ! ( 'type' in message ) ) {
				return;
			}
			const event = message as JsonEvent;
			sendAiReviewEventToRenderer( options.window, options.projectId, options.sessionId, event );
			if ( event.type === 'error' ) {
				lastErrorMessage = event.message;
			}
			if ( event.type === 'turn.completed' ) {
				turnStatus = event.status;
			}
			if ( event.type === 'question.asked' && child?.connected ) {
				const answers = Object.fromEntries(
					event.questions
						.map( ( question ) => [
							question.question,
							chooseAiReviewQuestionAnswer( question.options ),
						] )
						.filter( ( entry ): entry is [ string, string ] => Boolean( entry[ 1 ] ) )
				);
				child.send( { type: 'answer', answers } );
			}
		} );

		child.on( 'error', ( error ) => {
			sendAiReviewEventToRenderer( options.window, options.projectId, options.sessionId, {
				type: 'error',
				timestamp: nowIso(),
				message: error.message,
			} );
			void cleanupAndSettle( () => reject( error ) );
		} );

		child.on( 'exit', ( code ) => {
			void cleanupAndSettle( () => {
				sendAiReviewEventToRenderer( options.window, options.projectId, options.sessionId, {
					type: 'run.exited',
					timestamp: nowIso(),
					status: code === 0 && ( ! turnStatus || turnStatus === 'success' ) ? 'success' : 'error',
					code,
				} );
				if ( code !== 0 || ( turnStatus && turnStatus !== 'success' ) ) {
					reject(
						new Error(
							lastErrorMessage ||
								`Studio Code review failed${ code === null ? '' : ` with code ${ code }` }.`
						)
					);
					return;
				}
				resolve();
			} );
		} );
	} );
}

type ReadmeMetadata = {
	name?: string;
	contributors?: string[];
	tags?: string[];
	requiresAtLeast?: string;
	testedUpTo?: string;
	stableTag?: string;
	requiresPhp?: string;
	license?: string;
	licenseUri?: string;
};

const readmeHeaderMap: Record< string, keyof ReadmeMetadata > = {
	contributors: 'contributors',
	tags: 'tags',
	'requires at least': 'requiresAtLeast',
	'tested up to': 'testedUpTo',
	'stable tag': 'stableTag',
	'requires php': 'requiresPhp',
	license: 'license',
	'license uri': 'licenseUri',
};

function splitCsv( value: string ): string[] {
	return value
		.split( ',' )
		.map( ( item ) => item.trim() )
		.filter( Boolean );
}

function parseReadme( contents: string ): ReadmeMetadata {
	const lines = contents.split( /\r?\n/ );
	const metadata: ReadmeMetadata = {};
	const title = lines.find( ( line ) => /^===\s+.+?\s+===$/.test( line.trim() ) );
	if ( title ) {
		metadata.name = title
			.replace( /^===\s+/, '' )
			.replace( /\s+===$/, '' )
			.trim();
	}

	for ( const line of lines ) {
		const match = line.match( /^([^:\n]+):\s*(.*?)\s*$/ );
		if ( ! match ) {
			continue;
		}
		const key = readmeHeaderMap[ match[ 1 ].trim().toLowerCase() ];
		if ( ! key ) {
			continue;
		}
		const value = match[ 2 ].trim();
		if ( key === 'contributors' || key === 'tags' ) {
			metadata[ key ] = splitCsv( value );
		} else {
			metadata[ key ] = value;
		}
	}

	return metadata;
}

function validateReadmeLocally(
	contents: string,
	metadata: ReadmeMetadata,
	readmePath: string
): DevelopmentProjectValidationFinding[] {
	const findings: DevelopmentProjectValidationFinding[] = [];
	const add = (
		severity: DevelopmentProjectValidationFinding[ 'severity' ],
		code: string,
		message: string
	) => {
		findings.push( { source: 'readme', severity, code, message, file: readmePath, line: 1 } );
	};

	if ( ! metadata.name ) {
		add(
			'error',
			'readme.missing_title',
			'readme.txt must start with a plugin title like `=== Plugin Name ===`.'
		);
	}

	if ( ! metadata.contributors || metadata.contributors.length === 0 ) {
		add( 'warning', 'readme.missing_contributors', 'readme.txt should include Contributors.' );
	}

	if ( ! metadata.tags || metadata.tags.length === 0 ) {
		add( 'warning', 'readme.missing_tags', 'readme.txt should include Tags.' );
	} else if ( metadata.tags.length > 5 ) {
		add( 'error', 'readme.too_many_tags', 'WordPress.org allows at most 5 readme tags.' );
	}

	if ( ! metadata.stableTag ) {
		add( 'error', 'readme.missing_stable_tag', 'readme.txt must include a Stable tag header.' );
	}

	if ( ! metadata.requiresAtLeast ) {
		add(
			'warning',
			'readme.missing_requires_at_least',
			'readme.txt should include Requires at least.'
		);
	}

	if ( ! metadata.testedUpTo ) {
		add( 'warning', 'readme.missing_tested_up_to', 'readme.txt should include Tested up to.' );
	}

	if ( ! /^==\s+Description\s+==/im.test( contents ) ) {
		add(
			'warning',
			'readme.missing_description_section',
			'readme.txt should include a Description section.'
		);
	}

	return findings;
}

async function validateProjectReadme(
	project: DevelopmentProject
): Promise< DevelopmentProjectValidationFinding[] > {
	const rootDir = project.info?.rootDir || project.path;
	const readmePath = project.info?.readmePath
		? getDevelopmentProjectRelativePath( rootDir, project.info.readmePath )
		: 'readme.txt';
	const absoluteReadmePath = project.info?.readmePath || path.join( rootDir, 'readme.txt' );

	if ( ! ( await pathExists( absoluteReadmePath ) ) ) {
		return [
			{
				source: 'readme',
				severity: 'error',
				code: 'readme.missing',
				message: 'A WordPress.org plugin should include a readme.txt file.',
				file: readmePath,
				line: 1,
			},
		];
	}

	const contents = await fs.readFile( absoluteReadmePath, 'utf8' );
	return validateReadmeLocally( contents, parseReadme( contents ), readmePath );
}

function toPositiveNumber( value: unknown ): number | undefined {
	const numberValue = Number( value );
	return Number.isFinite( numberValue ) && numberValue > 0 ? numberValue : undefined;
}

function normalizeValidationSeverity(
	value: unknown
): DevelopmentProjectValidationFinding[ 'severity' ] {
	const text = String( value ?? '' ).toLowerCase();
	if ( text.includes( 'error' ) ) {
		return 'error';
	}
	if ( text.includes( 'warn' ) ) {
		return 'warning';
	}
	return 'info';
}

function getPluginCheckSetupFinding(
	output: string
): DevelopmentProjectValidationFinding | undefined {
	if (
		/'check' is not a registered subcommand of 'plugin'|not a registered subcommand/i.test( output )
	) {
		return {
			source: 'plugin-check',
			severity: 'warning',
			code: 'plugin_check.command_missing',
			message:
				'WordPress Plugin Check is not available in this Playground. Studio could not register `wp plugin check`.',
		};
	}

	if ( /No WordPress installation found/i.test( output ) ) {
		return {
			source: 'plugin-check',
			severity: 'warning',
			code: 'plugin_check.wordpress_path_missing',
			message: 'Plugin Check could not locate the Studio Playground WordPress installation.',
		};
	}

	return undefined;
}

function extractJson( output: string ): string | undefined {
	const trimmed = output.trim();
	const arrayStart = trimmed.indexOf( '[' );
	const objectStart = trimmed.indexOf( '{' );
	const start = [ arrayStart, objectStart ]
		.filter( ( index ) => index >= 0 )
		.sort( ( a, b ) => a - b )[ 0 ];
	if ( start === undefined ) {
		return undefined;
	}

	return extractBalancedJson( trimmed, start ) ?? trimmed.slice( start );
}

function extractBalancedJson( text: string, start: number ): string | undefined {
	const openingCharacter = text[ start ];
	const closingCharacter =
		openingCharacter === '[' ? ']' : openingCharacter === '{' ? '}' : undefined;
	if ( ! closingCharacter ) {
		return undefined;
	}

	let depth = 0;
	let inString = false;
	let isEscaped = false;

	for ( let index = start; index < text.length; index += 1 ) {
		const character = text[ index ];
		if ( inString ) {
			if ( isEscaped ) {
				isEscaped = false;
			} else if ( character === '\\' ) {
				isEscaped = true;
			} else if ( character === '"' ) {
				inString = false;
			}
			continue;
		}

		if ( character === '"' ) {
			inString = true;
		} else if ( character === openingCharacter ) {
			depth += 1;
		} else if ( character === closingCharacter ) {
			depth -= 1;
			if ( depth === 0 ) {
				return text.slice( start, index + 1 );
			}
		}
	}

	return undefined;
}

function firstString( ...values: unknown[] ): string | undefined {
	const value = values.find( ( item ) => typeof item === 'string' && item.length > 0 );
	return typeof value === 'string' ? value : undefined;
}

function normalizePluginCheckMessage( value: unknown ): string {
	return decodeHtmlEntities( String( value ?? 'Plugin Check finding' ) );
}

function normalizePluginCheckFindingPath(
	project: DevelopmentProject,
	file: string | undefined
): string | undefined {
	if ( ! file ) {
		return undefined;
	}

	const rootDir = path.resolve( project.info?.rootDir || project.path );
	const slug = project.info?.slug || project.slug;
	const normalized = file.replace( /\\/g, '/' );
	const pluginPrefix = `/wordpress/wp-content/plugins/${ slug }/`;
	if ( normalized.startsWith( pluginPrefix ) ) {
		return normalized.slice( pluginPrefix.length );
	}
	if ( normalized.startsWith( `${ slug }/` ) ) {
		return normalized.slice( slug.length + 1 );
	}
	if ( path.isAbsolute( file ) ) {
		const absolutePath = path.resolve( file );
		if ( absolutePath === rootDir ) {
			return undefined;
		}
		if ( absolutePath.startsWith( `${ rootDir }${ path.sep }` ) ) {
			return path.relative( rootDir, absolutePath ).split( path.sep ).join( '/' );
		}
	}
	return normalized.replace( /^\/+/, '' );
}

function normalizePluginCheckFindings(
	project: DevelopmentProject,
	parsed: unknown
): DevelopmentProjectValidationFinding[] {
	const records = Array.isArray( parsed )
		? parsed
		: typeof parsed === 'object' &&
		  parsed !== null &&
		  'results' in parsed &&
		  Array.isArray( parsed.results )
		? parsed.results
		: [];

	return records.flatMap( ( record ) => {
		if ( typeof record !== 'object' || record === null ) {
			return [];
		}

		const item = record as Record< string, unknown >;
		return [
			{
				source: 'plugin-check' as const,
				severity: normalizeValidationSeverity( item.type ?? item.severity ),
				message: normalizePluginCheckMessage( item.message ?? item.description ?? item.title ),
				code: item.code ? String( item.code ) : item.check ? String( item.check ) : undefined,
				file: normalizePluginCheckFindingPath(
					project,
					firstString( item.file, item.filename, item.path )
				),
				line: toPositiveNumber( item.line ),
				column: toPositiveNumber( item.column ),
			},
		];
	} );
}

function parsePluginCheckOutput(
	project: DevelopmentProject,
	output: string,
	exitCode = 0
): DevelopmentProjectValidationFinding[] {
	if ( ! output.trim() ) {
		return exitCode === 0
			? []
			: [
					{
						source: 'plugin-check',
						severity: 'error',
						code: 'plugin_check.failed',
						message: 'Plugin Check failed without JSON output.',
					},
			  ];
	}

	const setupFinding = getPluginCheckSetupFinding( output );
	if ( setupFinding ) {
		return [ setupFinding ];
	}

	const jsonText = extractJson( output );
	if ( ! jsonText ) {
		return [
			{
				source: 'plugin-check',
				severity: exitCode === 0 ? 'warning' : 'error',
				code: 'plugin_check.unparsed_output',
				message: output,
			},
		];
	}

	try {
		return normalizePluginCheckFindings( project, JSON.parse( jsonText ) );
	} catch {
		return [
			{
				source: 'plugin-check',
				severity: exitCode === 0 ? 'warning' : 'error',
				code: 'plugin_check.invalid_json',
				message: output,
			},
		];
	}
}

function normalizeValidationFindingColumn(
	finding: DevelopmentProjectValidationFinding
): DevelopmentProjectValidationFinding {
	if ( ! finding.line || finding.line < 1 ) {
		return finding;
	}

	return {
		...finding,
		column: finding.column && finding.column > 0 ? finding.column : 1,
	};
}

function resolveValidationFindingFilePath(
	rootDir: string,
	file: string | undefined
): string | undefined {
	if ( ! file ) {
		return undefined;
	}

	const projectRoot = path.resolve( rootDir );
	const normalizedFile = file.replace( /\\/g, '/' ).replace( /^\/+/, '' );
	const filePath = path.resolve( projectRoot, normalizedFile );
	return filePath === projectRoot || filePath.startsWith( `${ projectRoot }${ path.sep }` )
		? filePath
		: undefined;
}

function findReadmeLine( contents: string, pattern: RegExp ): number | undefined {
	const lines = contents.split( /\r?\n/ );
	const index = lines.findIndex( ( line ) => pattern.test( line ) );
	return index >= 0 ? index + 1 : undefined;
}

function inferReadmeFindingLine(
	finding: DevelopmentProjectValidationFinding,
	contents: string
): number | undefined {
	const haystack = `${ finding.code ?? '' } ${ finding.message }`.toLowerCase();
	const fieldPatterns: Array< [ RegExp, RegExp ] > = [
		[ /tested[_\s-]*(up[\s-]*to|upto)|tested up to/, /^\s*tested up to\s*:/i ],
		[ /stable[_\s-]*tag|stable tag/, /^\s*stable tag\s*:/i ],
		[ /requires[_\s-]*at[_\s-]*least|requires at least/, /^\s*requires at least\s*:/i ],
		[ /requires[_\s-]*php|requires php/, /^\s*requires php\s*:/i ],
		[ /license/, /^\s*license\s*:/i ],
		[ /contributors?/, /^\s*contributors\s*:/i ],
		[ /tags?/, /^\s*tags\s*:/i ],
		[ /donate/, /^\s*donate link\s*:/i ],
	];

	for ( const [ hint, linePattern ] of fieldPatterns ) {
		if ( hint.test( haystack ) ) {
			const line = findReadmeLine( contents, linePattern );
			if ( line ) {
				return line;
			}
		}
	}

	return findReadmeLine( contents, /^===\s+.+?\s+===$/ ) ?? 1;
}

function inferPluginHeaderFindingLine(
	finding: DevelopmentProjectValidationFinding,
	contents: string
): number | undefined {
	const haystack = `${ finding.code ?? '' } ${ finding.message }`.toLowerCase();
	const fieldPatterns: Array< [ RegExp, RegExp ] > = [
		[ /tested[_\s-]*(up[\s-]*to|upto)|tested up to/, /^\s*(?:\*\s*)?tested up to\s*:/i ],
		[ /stable[_\s-]*tag|stable tag/, /^\s*(?:\*\s*)?stable tag\s*:/i ],
		[ /requires[_\s-]*at[_\s-]*least|requires at least/, /^\s*(?:\*\s*)?requires at least\s*:/i ],
		[ /requires[_\s-]*php|requires php/, /^\s*(?:\*\s*)?requires php\s*:/i ],
		[ /text[_\s-]*domain|textdomain|text domain/, /^\s*(?:\*\s*)?text domain\s*:/i ],
		[ /plugin[_\s-]*name|plugin name/, /^\s*(?:\*\s*)?plugin name\s*:/i ],
		[ /description/, /^\s*(?:\*\s*)?description\s*:/i ],
		[ /version/, /^\s*(?:\*\s*)?version\s*:/i ],
		[ /author/, /^\s*(?:\*\s*)?author\s*:/i ],
		[ /license[_\s-]*uri|license uri/, /^\s*(?:\*\s*)?license uri\s*:/i ],
		[ /license/, /^\s*(?:\*\s*)?license\s*:/i ],
	];

	for ( const [ hint, linePattern ] of fieldPatterns ) {
		if ( hint.test( haystack ) ) {
			const line = findReadmeLine( contents, linePattern );
			if ( line ) {
				return line;
			}
		}
	}

	return undefined;
}

async function inferPluginCheckFindingLine(
	finding: DevelopmentProjectValidationFinding,
	rootDir: string
): Promise< number | undefined > {
	if ( ! finding.file ) {
		return undefined;
	}

	const filePath = resolveValidationFindingFilePath( rootDir, finding.file );
	if ( ! filePath ) {
		return 1;
	}

	try {
		const contents = await fs.readFile( filePath, 'utf8' );
		if ( path.basename( finding.file ).toLowerCase() === 'readme.txt' ) {
			return inferReadmeFindingLine( finding, contents ) ?? 1;
		}
		if ( path.extname( finding.file ).toLowerCase() === '.php' ) {
			return inferPluginHeaderFindingLine( finding, contents ) ?? 1;
		}
		return 1;
	} catch {
		return 1;
	}
}

async function addPluginCheckLineHints(
	project: DevelopmentProject,
	findings: DevelopmentProjectValidationFinding[]
): Promise< DevelopmentProjectValidationFinding[] > {
	const rootDir = project.info?.rootDir || project.path;
	return Promise.all(
		findings.map( async ( finding ) => {
			if ( finding.line && finding.line > 0 ) {
				return normalizeValidationFindingColumn( finding );
			}

			const line = await inferPluginCheckFindingLine( finding, rootDir );
			return normalizeValidationFindingColumn( {
				...finding,
				line,
			} );
		} )
	);
}

function getPluginCheckTarget( project: DevelopmentProject ): string {
	const rootDir = project.info?.rootDir || project.path;
	const slug = project.info?.slug || project.slug;
	if ( project.info?.mainFile ) {
		const relativeMainFile = path
			.relative( rootDir, project.info.mainFile )
			.split( path.sep )
			.join( '/' );
		if (
			relativeMainFile &&
			! relativeMainFile.startsWith( '..' ) &&
			! path.isAbsolute( relativeMainFile )
		) {
			return `${ slug }/${ relativeMainFile }`;
		}
	}

	return slug;
}

async function stageDevelopmentProjectForPluginCheck(
	server: SiteServer,
	project: DevelopmentProject
): Promise< () => Promise< void > > {
	const rootDir = project.info?.rootDir || project.path;
	const slug = project.info?.slug || project.slug;
	const sourceRoot = path.resolve( rootDir );
	const targetRoot = path.resolve( server.details.path, 'wp-content', 'plugins', slug );

	if ( sourceRoot === targetRoot ) {
		return async () => {};
	}

	const targetInsideSource = path.relative( sourceRoot, targetRoot );
	if (
		targetInsideSource &&
		! targetInsideSource.startsWith( '..' ) &&
		! path.isAbsolute( targetInsideSource )
	) {
		return async () => {};
	}

	const ignoreMatcher = createDevelopmentProjectIgnoreMatcher(
		await readDevelopmentProjectIgnorePatterns( sourceRoot )
	);

	await fs.rm( targetRoot, { force: true, recursive: true } );
	await fs.mkdir( path.dirname( targetRoot ), { recursive: true } );
	await fs.cp( sourceRoot, targetRoot, {
		dereference: true,
		filter: ( source ) =>
			shouldCopyDevelopmentProjectPathForValidation( sourceRoot, source, ignoreMatcher ),
		recursive: true,
	} );

	return async () => {
		await fs.rm( targetRoot, { force: true, recursive: true } );
	};
}

async function ensurePluginCheckCommand(
	server: SiteServer
): Promise< DevelopmentProjectValidationFinding | undefined > {
	const installed = await server.executeWpCliCommand( [
		'plugin',
		'is-installed',
		'plugin-check',
	] );
	if ( installed.exitCode !== 0 ) {
		const install = await server.executeWpCliCommand( [
			'plugin',
			'install',
			'plugin-check',
			'--activate',
		] );
		if ( install.exitCode !== 0 ) {
			return {
				source: 'plugin-check',
				severity: 'warning',
				code: 'plugin_check.install_failed',
				message:
					install.stderr || install.stdout || 'Studio could not install WordPress Plugin Check.',
			};
		}
		return undefined;
	}

	const activate = await server.executeWpCliCommand( [ 'plugin', 'activate', 'plugin-check' ] );
	if (
		activate.exitCode !== 0 &&
		! /already active/i.test( `${ activate.stdout }\n${ activate.stderr }` )
	) {
		return {
			source: 'plugin-check',
			severity: 'warning',
			code: 'plugin_check.activate_failed',
			message:
				activate.stderr || activate.stdout || 'Studio could not activate WordPress Plugin Check.',
		};
	}

	return undefined;
}

async function getRunningDevelopmentProjectPlayground(
	event: IpcMainInvokeEvent,
	projectId: string,
	project: DevelopmentProject
): Promise< SiteServer > {
	const result = await startDevelopmentProjectPlayground( event, projectId, {} );
	const server = SiteServer.get( result.siteId );
	if ( ! server ) {
		throw new Error( 'Development Playground site was not found.' );
	}
	if ( ! server.details.running ) {
		await server.start( {
			mounts: [ getDevelopmentPlaygroundMount( project ) ],
			autoStart: false,
		} );
		markServerRunning( server );
	}
	return server;
}

async function runProjectPluginCheck(
	event: IpcMainInvokeEvent,
	projectId: string,
	project: DevelopmentProject
): Promise< {
	available: boolean;
	findings: DevelopmentProjectValidationFinding[];
	rawOutput?: string;
} > {
	try {
		const server = await getRunningDevelopmentProjectPlayground( event, projectId, project );
		const setupFinding = await ensurePluginCheckCommand( server );
		if ( setupFinding ) {
			return { available: false, findings: [ setupFinding ] };
		}

		const cleanup = await stageDevelopmentProjectForPluginCheck( server, project );
		let rawOutput = '';
		let findings: DevelopmentProjectValidationFinding[] = [];
		try {
			const result = await server.executeWpCliCommand( [
				'plugin',
				'check',
				getPluginCheckTarget( project ),
				'--format=strict-json',
				'--fields=file,line,column,type,code,message,docs',
				'--mode=new',
			] );
			rawOutput = `${ result.stdout }\n${ result.stderr }`.trim();
			findings = await addPluginCheckLineHints(
				project,
				parsePluginCheckOutput( project, rawOutput, result.exitCode )
			);
		} finally {
			await cleanup();
		}

		return {
			available: ! findings.some( ( finding ) => finding.code === 'plugin_check.command_missing' ),
			findings,
			rawOutput,
		};
	} catch ( error ) {
		return {
			available: false,
			findings: [
				{
					source: 'plugin-check',
					severity: 'warning',
					code: 'plugin_check.failed',
					message: error instanceof Error ? error.message : String( error ),
				},
			],
		};
	}
}

function summarizeValidationFindings(
	findings: DevelopmentProjectValidationFinding[]
): DevelopmentProjectValidationResult[ 'summary' ] {
	const summary: DevelopmentProjectValidationResult[ 'summary' ] = {
		error: 0,
		warning: 0,
		info: 0,
		total: 0,
		readme: 0,
		pluginCheck: 0,
	};

	for ( const finding of findings ) {
		summary[ finding.severity ] += 1;
		summary.total += 1;
		if ( finding.source === 'readme' ) {
			summary.readme += 1;
		} else {
			summary.pluginCheck += 1;
		}
	}

	return summary;
}

function toPublicDevelopmentProjectValidationState(
	state: StoredDevelopmentProjectValidationState | undefined
): DevelopmentProjectValidationState {
	if ( ! state ) {
		return { status: 'idle' };
	}

	if ( state.status !== 'running' ) {
		return state;
	}

	return {
		status: 'running',
		startedAt: state.startedAt,
		previousResult: state.previousResult,
	};
}

function getPreviousValidationResult(
	state: StoredDevelopmentProjectValidationState | undefined
): DevelopmentProjectValidationResult | undefined {
	if ( state?.status === 'completed' ) {
		return state.result;
	}
	if ( state?.status === 'running' || state?.status === 'failed' ) {
		return state.previousResult;
	}
	return undefined;
}

async function runDevelopmentProjectValidationTask(
	event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectValidationResult > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	const [ readmeFindings, pluginCheck ] = await Promise.all( [
		validateProjectReadme( project ),
		runProjectPluginCheck( event, projectId, project ),
	] );
	const findings = [ ...readmeFindings, ...pluginCheck.findings ];

	return {
		checkedAt: new Date().toISOString(),
		findings,
		summary: summarizeValidationFindings( findings ),
		pluginCheckAvailable: pluginCheck.available,
		rawPluginCheckOutput: pluginCheck.rawOutput,
	};
}

function createDevelopmentPlaygroundBlueprint( project: DevelopmentProject ): Blueprint {
	if ( ! project.info ) {
		throw new Error( 'Project metadata is not available.' );
	}

	const relativeMainFile = path
		.relative( project.info.rootDir, project.info.mainFile )
		.split( path.sep )
		.join( '/' );

	return {
		landingPage: '/wp-admin/plugins.php',
		steps: [
			{
				step: 'writeFile',
				path: DEVELOPMENT_PLAYGROUND_MU_PLUGIN_PATH,
				data: DEVELOPMENT_PLAYGROUND_MU_PLUGIN,
			},
			{
				step: 'activatePlugin',
				pluginName: project.info.name,
				pluginPath: `/wordpress/wp-content/plugins/${ project.info.slug }/${ relativeMainFile }`,
			},
		],
	} as Blueprint;
}

function getDevelopmentPlaygroundMount( project: DevelopmentProject ) {
	if ( ! project.info ) {
		throw new Error( 'Project metadata is not available.' );
	}

	return {
		hostPath: project.info.rootDir,
		vfsPath: `/wordpress/wp-content/plugins/${ project.info.slug }`,
	};
}

async function getAvailablePlaygroundSitePath( slug: string ): Promise< string > {
	const baseDir = getDevelopmentPlaygroundSitesDirectory();
	await fs.mkdir( baseDir, { recursive: true } );

	const baseName = sanitizeFolderName( `${ slug } Playground` );
	for ( let index = 0; index < 100; index += 1 ) {
		const suffix = index === 0 ? '' : ` ${ index + 1 }`;
		const candidate = path.join( baseDir, `${ baseName }${ suffix }` );
		if ( ! ( await pathExists( candidate ) ) ) {
			return candidate;
		}
	}

	throw new Error( 'Could not find an available Playground site folder.' );
}

function toDevelopmentPlaygroundResult(
	project: DevelopmentProject,
	details: SiteDetails,
	wpVersion: string,
	phpVersion: string
): DevelopmentProjectPlaygroundResult {
	return {
		project,
		siteId: details.id,
		siteName: details.name,
		sitePath: details.path,
		url: details.running ? details.url : undefined,
		running: details.running,
		wpVersion,
		phpVersion,
	};
}

export async function listDevelopmentProjects(
	_event: IpcMainInvokeEvent
): Promise< DevelopmentProject[] > {
	return listProjectsFromRegistry();
}

export async function listRemoteDevelopmentPlugins(
	_event: IpcMainInvokeEvent
): Promise< RemoteDevelopmentPluginsResult > {
	const account = await getSavedWordPressOrgAccount();
	if ( ! account ) {
		return {
			source: 'none',
			plugins: [],
		};
	}

	const [ listedPlugins, projects ] = await Promise.all( [
		listLoggedInWordPressOrgPlugins( getWordPressOrgSession(), account.username ),
		listProjectsFromRegistry(),
	] );

	return {
		username: account.username,
		source: 'logged-in',
		plugins: listedPlugins.map( ( plugin ) => ( {
			...plugin,
			...getLocalState( plugin, projects ),
		} ) ),
	};
}

export async function addDevelopmentProject(
	_event: IpcMainInvokeEvent,
	projectPath: string
): Promise< DevelopmentProject > {
	return addProjectToRegistry( projectPath );
}

export async function removeDevelopmentProject(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProject[] > {
	return removeProjectFromRegistry( projectId );
}

export async function refreshDevelopmentProject(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProject > {
	return refreshProjectInRegistry( projectId );
}

export async function getDevelopmentProjectVersionState(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectVersionState > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	const info = await discoverPluginProject( project.path );
	const [ remoteVersion, svnTags ] = await Promise.all( [
		readRemotePluginVersion( info.slug ),
		readSvnTags( info.slug, info.rootDir ),
	] );

	return calculateDevelopmentProjectVersionState( {
		slug: info.slug,
		name: info.name,
		path: info.rootDir,
		localVersion: info.version,
		readmeStableTag: info.stableTag,
		remoteVersion,
		svnTags: svnTags.tags,
		svnTagsSource: svnTags.source,
	} );
}

export async function listDevelopmentProjectReleaseTags(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectReleaseTagList > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	return listReleaseTagsForProject( project );
}

export async function switchDevelopmentProjectReleaseTag(
	_event: IpcMainInvokeEvent,
	projectId: string,
	tagName: string
): Promise< DevelopmentProjectReleaseTagSwitchResult > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	const ref = await switchReleaseTagForProject( project, tagName );
	const refreshedProject = await refreshProjectInRegistry( projectId );

	return {
		ref,
		project: refreshedProject,
		tags: await listReleaseTagsForProject( refreshedProject ),
	};
}

export async function listDevelopmentProjectFiles(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectFilesResult > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	return listDevelopmentProjectFilesFromDisk( project );
}

export async function addDevelopmentProjectIgnorePattern(
	_event: IpcMainInvokeEvent,
	projectId: string,
	pattern: string
): Promise< DevelopmentProjectFilesResult > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	await addDevelopmentProjectIgnorePatternToDisk( project.info?.rootDir || project.path, pattern );
	await refreshProjectInRegistry( projectId ).catch( () => undefined );
	clearDevelopmentProjectValidationState( projectId );
	return listDevelopmentProjectFilesFromDisk( project );
}

export async function removeDevelopmentProjectIgnorePattern(
	_event: IpcMainInvokeEvent,
	projectId: string,
	pattern: string
): Promise< DevelopmentProjectFilesResult > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	await removeDevelopmentProjectIgnorePatternFromDisk(
		project.info?.rootDir || project.path,
		pattern
	);
	await refreshProjectInRegistry( projectId ).catch( () => undefined );
	clearDevelopmentProjectValidationState( projectId );
	return listDevelopmentProjectFilesFromDisk( project );
}

export async function readDevelopmentProjectFile(
	_event: IpcMainInvokeEvent,
	projectId: string,
	relativePath: string
): Promise< DevelopmentProjectFileContent > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	const targetPath = getDevelopmentProjectSafePath( project, relativePath );
	const stats = await fs.stat( targetPath );

	if ( ! stats.isFile() ) {
		throw new Error( 'Path is not a file.' );
	}
	const descriptor = getDevelopmentProjectFileDescriptor( targetPath, stats.size );
	if ( ! descriptor ) {
		throw new Error( 'This file is too large or cannot be previewed in Studio.' );
	}
	const content = descriptor.editable ? await fs.readFile( targetPath, 'utf8' ) : '';
	const dataUrl =
		descriptor.previewable && descriptor.mediaType
			? createDevelopmentProjectPreviewDataUrl(
					descriptor.mediaType,
					descriptor.editable ? content : await fs.readFile( targetPath )
			  )
			: undefined;

	return {
		path: normalizeDevelopmentProjectRelativePath( relativePath ),
		content,
		fileKind: descriptor.fileKind,
		mediaType: descriptor.mediaType,
		dataUrl,
		editable: descriptor.editable,
		previewable: descriptor.previewable,
		mode: descriptor.previewable ? 'preview' : 'code',
		updatedAt: stats.mtime.toISOString(),
	};
}

export async function writeDevelopmentProjectFile(
	_event: IpcMainInvokeEvent,
	projectId: string,
	relativePath: string,
	content: string
): Promise< DevelopmentProjectFileContent > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	const normalizedPath = normalizeDevelopmentProjectRelativePath( relativePath );
	const targetPath = getDevelopmentProjectSafePath( project, normalizedPath );

	if ( typeof content !== 'string' ) {
		throw new Error( 'File content must be text.' );
	}
	if ( Buffer.byteLength( content, 'utf8' ) > DEVELOPMENT_PROJECT_MAX_EDITABLE_FILE_SIZE ) {
		throw new Error( 'This file is too large to save from Studio.' );
	}
	const descriptor = getDevelopmentProjectFileDescriptor(
		targetPath,
		Buffer.byteLength( content, 'utf8' )
	);
	if ( ! descriptor?.editable ) {
		throw new Error( 'This file cannot be edited in Studio.' );
	}

	await fs.mkdir( path.dirname( targetPath ), { recursive: true } );
	await fs.writeFile( targetPath, content, 'utf8' );
	await refreshProjectInRegistry( projectId ).catch( () => undefined );
	clearDevelopmentProjectValidationState( projectId );
	const stats = await fs.stat( targetPath );
	const updatedDescriptor = getDevelopmentProjectFileDescriptor( targetPath, stats.size );
	const dataUrl =
		updatedDescriptor?.previewable && updatedDescriptor.mediaType
			? createDevelopmentProjectPreviewDataUrl( updatedDescriptor.mediaType, content )
			: undefined;

	return {
		path: normalizedPath,
		content,
		fileKind: updatedDescriptor?.fileKind ?? descriptor.fileKind,
		mediaType: updatedDescriptor?.mediaType ?? descriptor.mediaType,
		dataUrl,
		editable: updatedDescriptor?.editable ?? descriptor.editable,
		previewable: updatedDescriptor?.previewable ?? descriptor.previewable,
		mode: updatedDescriptor?.previewable ? 'preview' : 'code',
		updatedAt: stats.mtime.toISOString(),
	};
}

export async function applyDevelopmentProjectAiPatch(
	_event: IpcMainInvokeEvent,
	projectId: string,
	patch: DevelopmentProjectAiPatch
): Promise< DevelopmentProjectAiPatchResult > {
	const project = await getDevelopmentProjectOrThrow( projectId );
	const normalizedPath = normalizeDevelopmentProjectRelativePath( patch.path );
	const targetPath = getDevelopmentProjectSafePath( project, normalizedPath );

	if ( patch.status === 'deleted' ) {
		await fs.rm( targetPath, { force: true } );
	} else {
		const content = patch.afterContent ?? '';
		if ( Buffer.byteLength( content, 'utf8' ) > DEVELOPMENT_PROJECT_MAX_EDITABLE_FILE_SIZE ) {
			throw new Error( 'This patch is too large to apply from Studio.' );
		}
		await fs.mkdir( path.dirname( targetPath ), { recursive: true } );
		await fs.writeFile( targetPath, content, 'utf8' );
	}

	await refreshProjectInRegistry( projectId ).catch( () => undefined );
	clearDevelopmentProjectValidationState( projectId );
	const { files, directories } = await listDevelopmentProjectFilesFromDisk( project );
	return { files, directories };
}

export async function runDevelopmentProjectValidation(
	event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectValidationResult > {
	const currentState = developmentProjectValidationStates.get( projectId );
	if ( currentState?.status === 'running' ) {
		return currentState.promise;
	}

	const startedAt = new Date().toISOString();
	const previousResult = getPreviousValidationResult( currentState );
	const promise = runDevelopmentProjectValidationTask( event, projectId );
	developmentProjectValidationStates.set( projectId, {
		status: 'running',
		startedAt,
		previousResult,
		promise,
	} );

	try {
		const result = await promise;
		developmentProjectValidationStates.set( projectId, {
			status: 'completed',
			startedAt,
			completedAt: new Date().toISOString(),
			result,
		} );
		return result;
	} catch ( error ) {
		developmentProjectValidationStates.set( projectId, {
			status: 'failed',
			startedAt,
			completedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : String( error ),
			previousResult,
		} );
		throw error;
	}
}

export async function getDevelopmentProjectValidationState(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectValidationState > {
	await getDevelopmentProjectOrThrow( projectId );
	return toPublicDevelopmentProjectValidationState(
		developmentProjectValidationStates.get( projectId )
	);
}

export async function loadDevelopmentProjectChat(
	_event: IpcMainInvokeEvent,
	projectId: string
): Promise< DevelopmentProjectChatState > {
	await getDevelopmentProjectOrThrow( projectId );
	return loadDevelopmentProjectChatState( projectId );
}

export async function saveDevelopmentProjectChat(
	_event: IpcMainInvokeEvent,
	projectId: string,
	messages: DevelopmentProjectChatMessage[]
): Promise< DevelopmentProjectChatState > {
	await getDevelopmentProjectOrThrow( projectId );
	return saveDevelopmentProjectChatState( projectId, messages );
}

export async function runDevelopmentProjectAiReview(
	_event: IpcMainInvokeEvent,
	projectId: string,
	options: DevelopmentProjectAiReviewOptions
): Promise< DevelopmentProjectAiReviewResult > {
	if ( ! ( await oauthClient.isAuthenticated() ) ) {
		throw new Error( 'WordPress.com login required. Log in to use Studio Code.' );
	}

	const prompt = options.prompt.trim();
	if ( ! prompt ) {
		throw new Error( 'Enter a request for Studio Code.' );
	}

	const project = await getDevelopmentProjectOrThrow( projectId );
	const projectRoot = path.resolve( project.info?.rootDir || project.path );
	const validationResult = getPreviousValidationResult(
		developmentProjectValidationStates.get( projectId )
	);
	const { tempRootDir, tempProjectRoot } = await copyDevelopmentProjectForAiReview( project );
	const reviewWindow =
		typeof BrowserWindow.fromWebContents === 'function' && _event.sender
			? BrowserWindow.fromWebContents( _event.sender )
			: null;
	const session = await createAiSessionInStore( getAiSessionsRootDirectory(), {
		site: {
			name: project.name,
			path: tempProjectRoot,
		},
	} );

	try {
		await runAiReviewCliTurn( {
			projectId,
			sessionId: session.id,
			prompt: createAiReviewPrompt(
				project,
				{ ...options, prompt },
				tempProjectRoot,
				validationResult
			),
			displayMessage: prompt,
			workspacePath: tempProjectRoot,
			workspaceName: project.name,
			window: reviewWindow,
		} );

		return {
			sessionId: session.id,
			patches: await collectDevelopmentProjectAiPatches( projectRoot, tempProjectRoot ),
		};
	} finally {
		await fs.rm( tempRootDir, { recursive: true, force: true } ).catch( () => undefined );
	}
}

export async function bumpDevelopmentProjectVersion(
	_event: IpcMainInvokeEvent,
	projectId: string,
	bump: DevelopmentProjectVersionBump
): Promise< {
	project: DevelopmentProject;
	versionState: DevelopmentProjectVersionState;
} > {
	assertVersionBump( bump );
	const project = await getDevelopmentProjectOrThrow( projectId );
	const info = await discoverPluginProject( project.path );
	await bumpPluginProjectVersion( info, bump );
	const refreshedProject = await refreshProjectInRegistry( projectId );
	return {
		project: refreshedProject,
		versionState: await getDevelopmentProjectVersionState( _event, projectId ),
	};
}

export async function startDevelopmentProjectPlayground(
	_event: IpcMainInvokeEvent,
	projectId: string,
	options: DevelopmentProjectPlaygroundOptions = {}
): Promise< DevelopmentProjectPlaygroundResult > {
	let project = await getDevelopmentProjectOrThrow( projectId );
	const wpVersion = options.wpVersion || DEFAULT_WORDPRESS_VERSION;
	const phpVersion = options.phpVersion || DEFAULT_PHP_VERSION;
	const mounts = [ getDevelopmentPlaygroundMount( project ) ];
	const linkedServer = project.linkedSiteId ? SiteServer.get( project.linkedSiteId ) : undefined;

	if ( linkedServer && options.reset ) {
		await linkedServer.delete( true );
		project = await updateDevelopmentProjectLinkedSite( projectId, undefined );
	}

	if ( linkedServer && ! options.reset ) {
		if ( ! linkedServer.details.running ) {
			await linkedServer.start( { mounts, autoStart: false } );
			markServerRunning( linkedServer );
		}
		return toDevelopmentPlaygroundResult( project, linkedServer.details, wpVersion, phpVersion );
	}

	const siteName = `${ project.name } Playground`;
	const { server } = await SiteServer.create( {
		path: await getAvailablePlaygroundSitePath( project.slug ),
		name: siteName,
		wpVersion,
		phpVersion,
		blueprint: createDevelopmentPlaygroundBlueprint( project ),
		originalBlueprintPath: project.info?.rootDir,
		adminUsername: 'admin',
		adminPassword: 'password',
		adminEmail: 'admin@example.test',
		mounts,
		autoStart: false,
	} );
	if ( ! server.details.running ) {
		await server.start( { mounts, autoStart: false } );
		markServerRunning( server );
	}

	const linkedProject = await updateDevelopmentProjectLinkedSite( projectId, server.details.id );
	return toDevelopmentPlaygroundResult( linkedProject, server.details, wpVersion, phpVersion );
}

export async function cloneRemoteDevelopmentPlugin(
	_event: IpcMainInvokeEvent,
	slug: string
): Promise< DevelopmentProject > {
	assertWordPressOrgPluginSlug( slug );

	const existingProject = ( await listProjectsFromRegistry() ).find(
		( project ) => project.slug === slug && project.exists !== false
	);
	if ( existingProject ) {
		return existingProject;
	}

	const checkoutPath = path.join( getDevelopmentProjectsDirectory(), slug );
	await checkoutOrUpdatePlugin( slug, checkoutPath );
	return addProjectToRegistry( checkoutPath, 'clone' );
}
