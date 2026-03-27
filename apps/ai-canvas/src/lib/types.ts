export interface PickedElement {
	tagName: string;
	selector: string;
	outerHTML: string;
	innerText: string;
	computedStyles: Record< string, string >;
	boundingRect: { x: number; y: number; width: number; height: number };
	wpBlockType: string | null;
	ancestors: string[];
}

export interface HighlightRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export type PickerState = 'loading' | 'picking' | 'confirming' | 'done';
