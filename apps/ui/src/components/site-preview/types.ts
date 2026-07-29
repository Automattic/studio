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

// Page-local description of an element the user picked out of the preview,
// handed to the composer by "Add to Chat".
export interface PreviewElementReference {
	selector?: string;
	tag?: string;
	nearbyText?: string;
	url?: string;
	pathname?: string;
}
