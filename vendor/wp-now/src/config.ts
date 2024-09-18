import { SupportedPHPVersion, SupportedPHPVersionsList } from '@php-wasm/universal';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { Blueprint } from '@wp-playground/blueprints';
import { getCodeSpaceURL, isGitHubCodespace } from './github-codespaces';
import { inferMode } from './wp-now';
import { portFinder } from './port-finder';
import { isValidWordPressVersion } from './wp-playground-wordpress';
import getWpNowPath from './get-wp-now-path';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from './constants';

export interface CliOptions {
	php?: string;
	path?: string;
	wp?: string;
	port?: number;
	blueprint?: string;
	reset?: boolean;
	adminPassword?: string;
	siteTitle?: string;
}

export const enum WPNowMode {
	PLUGIN = 'plugin',
	THEME = 'theme',
	WORDPRESS = 'wordpress',
	WORDPRESS_DEVELOP = 'wordpress-develop',
	INDEX = 'index',
	WP_CONTENT = 'wp-content',
	PLAYGROUND = 'playground',
	AUTO = 'auto',
}

export interface WPNowOptions {
	phpVersion?: SupportedPHPVersion;
	documentRoot?: string;
	absoluteUrl?: string;
	mode?: WPNowMode;
	port?: number;
	projectPath?: string;
	wpContentPath?: string;
	wordPressVersion?: string;
	numberOfPhpInstances?: number;
	blueprintObject?: Blueprint;
	reset?: boolean;
	adminPassword?: string;
	siteTitle?: string;
	siteLanguage?: string;
}

export const DEFAULT_OPTIONS: WPNowOptions = {
	phpVersion: DEFAULT_PHP_VERSION,
	wordPressVersion: DEFAULT_WORDPRESS_VERSION,
	documentRoot: '/var/www/html',
	projectPath: process.cwd(),
	mode: WPNowMode.AUTO,
	numberOfPhpInstances: 1,
	reset: false,
	adminPassword: 'password',
	siteTitle: 'My WordPress Website',
	siteLanguage: 'en',
};

export interface WPEnvOptions {
	core: string | null;
	phpVersion: SupportedPHPVersion | null;
	plugins: string[];
	themes: string[];
	port: number;
	testsPort: number;
	config: Object;
	mappings: Object;
}

let absoluteUrlFromBlueprint = '';

async function getAbsoluteURL() {
	const port = await portFinder.getOpenPort();
	if ( isGitHubCodespace ) {
		return getCodeSpaceURL( port );
	}

	if ( absoluteUrlFromBlueprint ) {
		return absoluteUrlFromBlueprint;
	}

	const url = 'http://localhost';
	if ( port === 80 ) {
		return url;
	}
	return `${ url }:${ port }`;
}

function getWpContentHomePath( projectPath: string, mode: string ) {
	const basename = path.basename( projectPath );
	const directoryHash = crypto.createHash( 'sha1' ).update( projectPath ).digest( 'hex' );
	const projectDirectory =
		mode === WPNowMode.PLAYGROUND ? 'playground' : `${ basename }-${ directoryHash }`;
	return path.join( getWpNowPath(), 'wp-content', projectDirectory );
}

export default async function getWpNowConfig( args: CliOptions ): Promise< WPNowOptions > {
	if ( args.port ) {
		portFinder.setPort( args.port );
	}
	const port = await portFinder.getOpenPort();
	const optionsFromCli: WPNowOptions = {
		phpVersion: args.php as SupportedPHPVersion,
		projectPath: args.path as string,
		wordPressVersion: args.wp as string,
		port,
		reset: args.reset as boolean,
	};

	const options: WPNowOptions = {} as WPNowOptions;

	[ optionsFromCli, DEFAULT_OPTIONS ].forEach( ( config ) => {
		for ( const key in config ) {
			if ( ! options[ key ] ) {
				options[ key ] = config[ key ];
			}
		}
	} );

	if ( ! options.mode || options.mode === 'auto' ) {
		options.mode = inferMode( options.projectPath );
	}
	if ( ! options.wpContentPath ) {
		options.wpContentPath = getWpContentHomePath( options.projectPath, options.mode );
	}
	if ( ! options.absoluteUrl ) {
		options.absoluteUrl = await getAbsoluteURL();
	}
	if ( ! isValidWordPressVersion( options.wordPressVersion ) ) {
		throw new Error(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
	}
	if ( options.phpVersion && ! SupportedPHPVersionsList.includes( options.phpVersion ) ) {
		throw new Error(
			`Unsupported PHP version: ${
				options.phpVersion
			}. Supported versions: ${ SupportedPHPVersionsList.join( ', ' ) }`
		);
	}
	if ( args.blueprint ) {
		const blueprintPath = path.resolve( args.blueprint );
		if ( ! fs.existsSync( blueprintPath ) ) {
			throw new Error( `Blueprint file not found: ${ blueprintPath }` );
		}
		const blueprintObject = JSON.parse( fs.readFileSync( blueprintPath, 'utf8' ) );

		options.blueprintObject = blueprintObject;
		const siteUrl = extractSiteUrlFromBlueprint( blueprintObject );
		if ( siteUrl ) {
			options.absoluteUrl = siteUrl;
			absoluteUrlFromBlueprint = siteUrl;
		}
	}
	if ( args.adminPassword ) {
		options.adminPassword = args.adminPassword;
	}
	if ( args.siteTitle ) {
		options.siteTitle = args.siteTitle;
	}
	return options;
}

function extractSiteUrlFromBlueprint( blueprintObject: Blueprint ): string | false {
	for ( const step of blueprintObject.steps ) {
		if ( typeof step !== 'object' ) {
			return false;
		}

		if ( step.step === 'defineSiteUrl' ) {
			return `${ step.siteUrl }`;
		} else if ( step.step === 'defineWpConfigConsts' && step.consts.WP_SITEURL ) {
			return `${ step.consts.WP_SITEURL }`;
		}
	}
	return false;
}
