// Annotation payload assembled by the React site-preview inspector. The
// injected page runtime only supplies page-local target metadata.
export interface Annotation {
	id: string;
	comment: string;
	selector?: string;
	tag?: string;
	nearbyText?: string;
	url?: string;
	pathname?: string;
	timestamp?: number;
	[ key: string ]: unknown;
}
