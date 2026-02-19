import { StatsMetric } from '@studio/common/types/stats';
import {
	JetpackImporter,
	LocalImporter,
	PlaygroundImporter,
	SQLImporter,
	WpressImporter,
} from 'src/lib/import-export/import/importers';

export function getPlatformMetric( platform: typeof process.platform ): StatsMetric {
	switch ( platform ) {
		case 'darwin':
			return StatsMetric.DARWIN;
		case 'linux':
			return StatsMetric.LINUX;
		case 'win32':
			return StatsMetric.WINDOWS;
		default:
			return StatsMetric.UNKNOWN_PLATFORM;
	}
}

export function getImporterMetric( importer?: string ): StatsMetric {
	switch ( importer ) {
		case JetpackImporter.name:
			return StatsMetric.JETPACK_IMPORTER;
		case LocalImporter.name:
			return StatsMetric.LOCAL_IMPORTER;
		case SQLImporter.name:
			return StatsMetric.SQL_IMPORTER;
		case PlaygroundImporter.name:
			return StatsMetric.PLAYGROUND_IMPORTER;
		case WpressImporter.name:
			return StatsMetric.WPRESS_IMPORTER;
		default:
			return StatsMetric.UNKNOWN_IMPORTER;
	}
}

export function getBlueprintMetric( blueprintSlug: string | undefined ) {
	if ( ! blueprintSlug ) {
		return StatsMetric.NO_BLUEPRINT;
	}
	if ( blueprintSlug?.startsWith( 'file:' ) ) {
		return StatsMetric.FILE_BLUEPRINT;
	}
	return StatsMetric.REMOTE_BLUEPRINT;
}
