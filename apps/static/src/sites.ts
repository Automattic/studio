import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_EVENTS, type SiteEvent } from '@studio/common/lib/cli-events';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { PlaygroundRuntimes, getSiteUrl, type FreshSiteOptions } from './playground';
import { applySettingsToWpConfig, copySiteFiles, importBackup, removeSiteFiles } from './site-data';
import { kvDelete, kvGet, kvSet, kvUpdate } from './store';
import type { CreateSiteParams, StaticSiteDetails, StaticSiteSettings } from './types';
import type { SiteOperationKind } from '@studio/common/lib/site-operation';
import type { WpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import type { BlueprintBundle, PlaygroundClient } from '@wp-playground/client';

const SITES_KEY = 'sites';
const DEFAULT_ADMIN_PASSWORD = 'password';

// What Studio on the web keeps per site. The files themselves live in OPFS.
export interface StaticSiteRecord {
	id: string;
	name: string;
	// A virtual path that names the site's files for the agent: `/sites/<slug>`
	// maps to `/wordpress` inside the site's runtime.
	path: string;
	scope: string;
	phpVersion: string;
	// `latest` keeps the site on the newest WordPress on every start.
	wpVersion: string;
	adminUsername: string;
	adminPassword: string;
	adminEmail?: string;
	enableDebugLog?: boolean;
	enableDebugDisplay?: boolean;
	enableScriptDebug?: boolean;
	environmentType?: WpEnvironmentType;
	createdAt: number;
	sortOrder?: number;
	// Set once the site's files reached OPFS: a site whose first boot failed
	// installs again on its next start.
	installed: boolean;
}

function slugify( name: string ): string {
	return (
		name
			.toLowerCase()
			.normalize( 'NFKD' )
			.replace( /[̀-ͯ]/g, '' )
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-+|-+$/g, '' ) || 'site'
	);
}

export class StaticSites {
	readonly runtimes = new PlaygroundRuntimes();
	private readonly operations = new Map< string, SiteOperationKind >();
	private readonly listeners = new Set< ( event: SiteEvent ) => void >();
	// A fresh site's Blueprint runs on its first start.
	private readonly pendingInstalls = new Map< string, FreshSiteOptions >();

	async list(): Promise< StaticSiteRecord[] > {
		return ( await kvGet< StaticSiteRecord[] >( SITES_KEY ) ) ?? [];
	}

	async get( id: string ): Promise< StaticSiteRecord > {
		const record = ( await this.list() ).find( ( site ) => site.id === id );
		if ( ! record ) {
			throw new Error( `Site ${ id } not found` );
		}
		return record;
	}

	// Resolves the site a virtual path (`/sites/<slug>/…`) belongs to.
	async findByPath( path: string ): Promise< StaticSiteRecord | undefined > {
		return ( await this.list() ).find(
			( site ) => path === site.path || path.startsWith( `${ site.path }/` )
		);
	}

	toDetails( record: StaticSiteRecord ): StaticSiteDetails {
		const running = this.runtimes.isRunning( record.id );
		const operation = this.operations.get( record.id );
		return {
			id: record.id,
			name: record.name,
			path: record.path,
			port: 0,
			running,
			url: getSiteUrl( record.scope ),
			phpVersion: record.phpVersion,
			isWpAutoUpdating: record.wpVersion === 'latest',
			adminUsername: record.adminUsername,
			adminPassword: encodePassword( record.adminPassword ),
			adminEmail: record.adminEmail,
			enableDebugLog: record.enableDebugLog,
			enableDebugDisplay: record.enableDebugDisplay,
			enableScriptDebug: record.enableScriptDebug,
			environmentType: record.environmentType,
			sortOrder: record.sortOrder,
			...( operation ? { operation: { pid: 0, kind: operation } } : {} ),
		};
	}

	async getDetails(): Promise< StaticSiteDetails[] > {
		return ( await this.list() ).map( ( record ) => this.toDetails( record ) );
	}

	onEvent( listener: ( event: SiteEvent ) => void ): () => void {
		this.listeners.add( listener );
		return () => this.listeners.delete( listener );
	}

	private async emit( event: SITE_EVENTS, id: string ) {
		const record = ( await this.list() ).find( ( site ) => site.id === id );
		const details = record ? this.toDetails( record ) : undefined;
		const payload: SiteEvent = {
			event,
			siteId: id,
			running: details?.running ?? false,
			...( details ? { site: { ...details, url: details.url ?? '' } } : {} ),
		};
		this.listeners.forEach( ( listener ) => listener( payload ) );
	}

	private async withOperation< T >(
		id: string,
		kind: SiteOperationKind,
		run: () => Promise< T >
	): Promise< T > {
		this.operations.set( id, kind );
		await this.emit( SITE_EVENTS.OPERATIONS_CHANGED, id );
		try {
			return await run();
		} finally {
			this.operations.delete( id );
			await this.emit( SITE_EVENTS.UPDATED, id );
		}
	}

	private async save( record: StaticSiteRecord ) {
		await kvUpdate< StaticSiteRecord[] >( SITES_KEY, [], ( sites ) => {
			const index = sites.findIndex( ( site ) => site.id === record.id );
			return index === -1
				? [ ...sites, record ]
				: sites.map( ( site ) => ( site.id === record.id ? record : site ) );
		} );
	}

	async uniquePath( name: string ): Promise< string > {
		const used = new Set( ( await this.list() ).map( ( site ) => site.path ) );
		const base = `/sites/${ slugify( name ) }`;
		let candidate = base;
		for ( let suffix = 2; used.has( candidate ); suffix++ ) {
			candidate = `${ base }-${ suffix }`;
		}
		return candidate;
	}

	async create( params: CreateSiteParams, bundle?: BlueprintBundle ): Promise< StaticSiteDetails > {
		const id = crypto.randomUUID();
		const record: StaticSiteRecord = {
			id,
			name: params.name,
			path:
				params.path && ! ( await this.findByPath( params.path ) )
					? params.path
					: await this.uniquePath( params.name ),
			scope: `studio-${ id.replace( /-/g, '' ).slice( 0, 12 ) }`,
			phpVersion: params.phpVersion ?? DEFAULT_PHP_VERSION,
			wpVersion: params.wpVersion ?? 'latest',
			adminUsername: params.adminUsername || 'admin',
			adminPassword: params.adminPassword || DEFAULT_ADMIN_PASSWORD,
			adminEmail: params.adminEmail,
			createdAt: Date.now(),
			installed: false,
		};
		await this.save( record );
		this.pendingInstalls.set( id, {
			siteName: params.name,
			adminUsername: params.adminUsername,
			adminPassword: params.adminPassword,
			adminEmail: params.adminEmail,
			blueprint: params.blueprint?.blueprint,
			bundle,
		} );
		await this.emit( SITE_EVENTS.CREATED, id );
		if ( ! params.skipStart ) {
			await this.start( id );
		}
		return this.toDetails( await this.get( id ) );
	}

	async start( id: string ): Promise< void > {
		const booting = this.runtimes.client( id );
		if ( booting ) {
			await booting;
			return;
		}
		await this.withOperation( id, 'start', () => this.boot( id ) );
	}

	private async boot( id: string ): Promise< PlaygroundClient > {
		const record = await this.get( id );
		const config = {
			id,
			scope: record.scope,
			phpVersion: record.phpVersion,
			wpVersion: record.wpVersion,
		};
		if ( record.installed ) {
			const client = await this.runtimes.start( config );
			await applySettingsToWpConfig( client, record );
			return client;
		}
		const client = await this.runtimes.create(
			config,
			this.pendingInstalls.get( id ) ?? { siteName: record.name }
		);
		this.pendingInstalls.delete( id );
		await applySettingsToWpConfig( client, record );
		await this.save( { ...( await this.get( id ) ), installed: true } );
		return client;
	}

	async stop( id: string ): Promise< void > {
		if ( ! this.runtimes.client( id ) ) {
			return;
		}
		await this.withOperation( id, 'stop', () => this.runtimes.stop( id ) );
	}

	// The site's runtime, started on demand: file and database work needs one.
	async client( id: string ): Promise< PlaygroundClient > {
		const running = this.runtimes.client( id );
		if ( running ) {
			return running;
		}
		await this.start( id );
		return this.runtimes.client( id )!;
	}

	async delete( id: string ): Promise< void > {
		await this.withOperation( id, 'delete', async () => {
			// Starts a stopped site to reach its files: the browser keeps them
			// otherwise, since Studio asks it to persist its storage.
			await removeSiteFiles( await this.client( id ) );
			await this.runtimes.stop( id );
			await kvUpdate< StaticSiteRecord[] >( SITES_KEY, [], ( sites ) =>
				sites.filter( ( site ) => site.id !== id )
			);
			await kvDelete( `thumbnail:${ id }` );
		} );
		await this.emit( SITE_EVENTS.DELETED, id );
	}

	async copy( sourceId: string, name: string ): Promise< StaticSiteDetails > {
		const source = await this.get( sourceId );
		const copy = await this.create( {
			name,
			path: await this.uniquePath( name ),
			phpVersion: source.phpVersion as CreateSiteParams[ 'phpVersion' ],
			wpVersion: source.wpVersion,
			adminUsername: source.adminUsername,
			adminPassword: source.adminPassword,
			adminEmail: source.adminEmail,
			skipStart: true,
		} );
		await this.withOperation( copy.id, 'duplicate', async () => {
			const wasRunning = this.runtimes.isRunning( sourceId );
			const sourceClient = await this.client( sourceId );
			const targetClient = await this.boot( copy.id );
			await copySiteFiles( sourceClient, targetClient );
			if ( ! wasRunning ) {
				await this.runtimes.stop( sourceId );
			}
		} );
		return this.toDetails( await this.get( copy.id ) );
	}

	async update( site: StaticSiteSettings, wpVersion?: string ): Promise< void > {
		const record = await this.get( site.id );
		const next: StaticSiteRecord = {
			...record,
			name: site.name,
			phpVersion: site.phpVersion,
			wpVersion: wpVersion ?? ( site.isWpAutoUpdating === false ? record.wpVersion : 'latest' ),
			adminUsername: site.adminUsername ?? record.adminUsername,
			adminPassword: site.adminPassword
				? decodePassword( site.adminPassword )
				: record.adminPassword,
			adminEmail: site.adminEmail ?? record.adminEmail,
			enableDebugLog: site.enableDebugLog,
			enableDebugDisplay: site.enableDebugDisplay,
			enableScriptDebug: site.enableScriptDebug,
			environmentType: site.environmentType,
		};
		await this.save( next );
		const restart =
			this.runtimes.isRunning( site.id ) &&
			( next.phpVersion !== record.phpVersion || next.wpVersion !== record.wpVersion );
		if ( restart ) {
			await this.withOperation( site.id, 'settings', async () => {
				await this.runtimes.stop( site.id );
				await this.boot( site.id );
			} );
		} else {
			const client = this.runtimes.client( site.id );
			if ( client ) {
				await applySettingsToWpConfig( await client, next );
			}
			await this.emit( SITE_EVENTS.UPDATED, site.id );
		}
	}

	async updateSortOrder( updates: { siteId: string; sortOrder: number }[] ) {
		const order = new Map( updates.map( ( update ) => [ update.siteId, update.sortOrder ] ) );
		await kvUpdate< StaticSiteRecord[] >( SITES_KEY, [], ( sites ) =>
			sites.map( ( site ) =>
				order.has( site.id ) ? { ...site, sortOrder: order.get( site.id ) } : site
			)
		);
	}

	async rename( id: string, name: string ) {
		await this.save( { ...( await this.get( id ) ), name } );
		await this.emit( SITE_EVENTS.UPDATED, id );
	}

	async import( id: string, file: File ): Promise< void > {
		await this.withOperation( id, 'import', async () => {
			await importBackup(
				await this.client( id ),
				file.name,
				new Uint8Array( await file.arrayBuffer() )
			);
		} );
	}

	async getThumbnail( id: string ): Promise< string | null > {
		return ( await kvGet< string >( `thumbnail:${ id }` ) ) ?? null;
	}

	async setThumbnail( id: string, dataUrl: string ) {
		await kvSet( `thumbnail:${ id }`, dataUrl );
	}
}
