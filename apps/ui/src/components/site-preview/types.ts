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

export type PreviewConsoleLevel = 'debug' | 'log' | 'info' | 'warning' | 'error';

export interface PreviewConsoleEntry {
	id: string;
	level: PreviewConsoleLevel;
	message: string;
	timestamp: number;
	sourceId?: string;
	lineNumber?: number;
}

export interface PreviewConsoleTextFile {
	name: string;
	contents: string;
	mimeType: 'text/plain';
	size: number;
}
