// Subset of the inspector annotation that the host needs to know about.
// The inspector (in `inspector-page-script.ts`) builds these and ships
// them via the `done` event when the user clicks Done in the toolbar.
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
