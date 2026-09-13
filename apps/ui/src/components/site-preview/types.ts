// Annotation payload assembled by the React site-preview inspector. The
// injected page runtime only supplies page-local target metadata.
export interface Annotation {
	id: string;
	comment: string;
	selector?: string;
	tag?: string;
	classes?: string[];
	nearbyText?: string;
	url?: string;
	path?: string;
	// CSS-pixel size of the preview viewport when the note was made, so a
	// note left in the Mobile preset reads differently from a desktop one.
	viewport?: { width: number; height: number };
	timestamp?: number;
	[ key: string ]: unknown;
}
