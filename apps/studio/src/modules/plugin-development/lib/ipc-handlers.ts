import { spawn } from 'child_process';
import { BrowserWindow, session, type IpcMainInvokeEvent, type Session } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
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
import { WORDPRESS_ORG_AUTH_SESSION_PARTITION } from 'src/constants';
import {
	getSavedWordPressOrgAccount,
	getWordPressOrgLoginUserAgent,
} from 'src/modules/user-settings/lib/wordpress-org-auth';
import { SiteServer } from 'src/site-server';
import type {
	DevelopmentProject,
	DevelopmentProjectPlaygroundOptions,
	DevelopmentProjectPlaygroundResult,
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

const WORDPRESS_ORG_PLUGIN_ARCHIVE_PAGE_LIMIT = 20;
const WORDPRESS_ORG_PLUGIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SVN_OUTPUT_CAPTURE_BYTES = 80 * 1024;
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
				step: 'mkdir',
				path: '/wordpress/wp-content/mu-plugins',
			},
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
