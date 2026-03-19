export interface MetricConfig {
	label: string;
	format: ( value: number ) => string;
	threshold: number;
}

const BYTES_PER_MB = 1_048_576;

const sizeFormatter = ( value: number ) => `${ ( value / BYTES_PER_MB ).toFixed( 2 ) } MB`;
const timeFormatter = ( value: number ) => `${ value } ms`;

export const METRIC_CONFIG: Record< string, MetricConfig > = {
	appSizeMac: { label: 'App Size (Mac)', format: sizeFormatter, threshold: BYTES_PER_MB },
};

const DEFAULT_METRIC_CONFIG: MetricConfig = { label: '', format: timeFormatter, threshold: 50 };

export function getMetricConfig( metric: string ): MetricConfig {
	return METRIC_CONFIG[ metric ] ?? { ...DEFAULT_METRIC_CONFIG, label: metric };
}
