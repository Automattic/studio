export type MetricUnit = 'ms' | 'MB';

export interface MetricConfig {
	label: string;
	unit: MetricUnit;
	threshold: number;
}

export const BYTES_PER_MB = 1_048_576;

export const METRIC_CONFIG: Record< string, MetricConfig > = {
	appSizeMac: { label: 'App Size (Mac)', unit: 'MB', threshold: BYTES_PER_MB },
	appSizeWin: { label: 'App Size (Win)', unit: 'MB', threshold: BYTES_PER_MB },
};

export function getMetricConfig( metric: string ): MetricConfig {
	return METRIC_CONFIG[ metric ] ?? { label: metric, unit: 'ms', threshold: 50 };
}

export function formatMetricValue( metric: string, value: number ): string {
	const { unit } = getMetricConfig( metric );
	if ( unit === 'MB' ) {
		return `${ ( value / BYTES_PER_MB ).toFixed( 2 ) } MB`;
	}
	return `${ value } ms`;
}
