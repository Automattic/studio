import type { StudioChatArtifactWidgetDraft } from './chat-artifacts';

interface StudioWidgetSpec {
	type: string;
	description: string;
	propsDescription: string;
	example: StudioChatArtifactWidgetDraft;
	validateWidgetProps: ( props: Record< string, unknown > ) => boolean;
}

interface StudioPresentationRule {
	id: string;
	description: string;
}

const MIN_WIDGET_SHAPE_SIZE = 80;

export const STUDIO_PRESENTATION_RULES: StudioPresentationRule[] = [
	{
		id: 'live-preview',
		description:
			'Present a site-preview only for meaningful user-visible local site milestones, useful preview paths, or page states worth keeping in view. Do not present routine inspection, low-level file reads, internal edits, noisy intermediate steps, or captured screenshots.',
	},
];

export const STUDIO_PRESENTABLE_WIDGET_SPECS: StudioWidgetSpec[] = [
	{
		type: 'site-preview',
		description:
			'A live preview of the current local site at a path or URL. Do not use this for captured screenshots.',
		propsDescription: '{ "path": "/" } where path is a relative path like "/about" or a URL.',
		example: { type: 'site-preview', widgetProps: { path: '/' } },
		validateWidgetProps: ( props ) => typeof props.path === 'string',
	},
];

export function getStudioPresentableWidgetTypes(): string[] {
	return STUDIO_PRESENTABLE_WIDGET_SPECS.map( ( spec ) => spec.type );
}

export function getStudioPresentationRulesPrompt(): string {
	return STUDIO_PRESENTATION_RULES.map( ( rule ) => `- ${ rule.id }: ${ rule.description }` ).join(
		'\n'
	);
}

export function getStudioWidgetPromptManifest(): string {
	return STUDIO_PRESENTABLE_WIDGET_SPECS.map(
		( spec ) =>
			`- ${ spec.type }: ${ spec.description } Props: ${
				spec.propsDescription
			} Example: ${ JSON.stringify( spec.example ) }`
	).join( '\n' );
}

export function getStudioWidgetDraftValidationError( value: unknown ): string | null {
	if ( ! isRecord( value ) ) {
		return 'Widget must be an object.';
	}

	if ( typeof value.type !== 'string' ) {
		return 'Widget type must be a string.';
	}

	if ( ! isRecord( value.widgetProps ) ) {
		return `Widget "${ value.type }" must include widgetProps as an object.`;
	}

	if ( value.shapeProps !== undefined && ! isShapeProps( value.shapeProps ) ) {
		return `Widget "${ value.type }" shapeProps may only include numeric w and h between ${ MIN_WIDGET_SHAPE_SIZE } and 3000.`;
	}

	const spec = STUDIO_PRESENTABLE_WIDGET_SPECS.find(
		( candidate ) => candidate.type === value.type
	);
	if ( ! spec ) {
		return `Unsupported widget type "${
			value.type
		}". Supported types: ${ getStudioPresentableWidgetTypes().join( ', ' ) }.`;
	}

	if ( ! spec.validateWidgetProps( value.widgetProps ) ) {
		return `Invalid widgetProps for "${ spec.type }". Expected: ${ spec.propsDescription }`;
	}

	return null;
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

function isShapeProps( value: unknown ): boolean {
	if ( ! isRecord( value ) ) {
		return false;
	}

	const keys = Object.keys( value );
	if ( keys.some( ( key ) => key !== 'w' && key !== 'h' ) ) {
		return false;
	}

	return keys.every(
		( key ) =>
			typeof value[ key ] === 'number' &&
			Number.isFinite( value[ key ] ) &&
			value[ key ] >= MIN_WIDGET_SHAPE_SIZE &&
			value[ key ] <= 3000
	);
}
