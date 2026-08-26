import type { SiteInfo } from 'cli/ai/types';

type LocalSiteSelectedCallback = ( site: SiteInfo ) => void | Promise< void >;

let localSiteSelectedCallback: LocalSiteSelectedCallback | null = null;

export function setLocalSiteSelectedCallback( callback: LocalSiteSelectedCallback | null ) {
	localSiteSelectedCallback = callback;
}

export async function emitLocalSiteSelected( site: SiteInfo ): Promise< void > {
	await localSiteSelectedCallback?.( site );
}
