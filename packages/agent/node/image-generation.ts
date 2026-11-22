import type { GenerateImageRequest, GenerateImageResult } from '@studio/providers';

/**
 * Prompt composition for AI image generation; a provider that offers it
 * renders the prompts (`ai.generateImages` in `@studio/providers`).
 *
 * A TypeScript port of minimalistic-site-builder's image subsystem
 * (GeminiImage / WpcomImageClient / ImagePromptComposer), trimmed for an
 * agentic host: the agent authors each image spec at call time following the
 * `imagery` skill's rules, so the builder's deterministic prompt-sanitization
 * machinery (grade-token stripping, pictorial page-context recasting) is
 * replaced by authoring guidance, and its LLM prompt-repair pass is replaced by
 * reporting safety-filtered failures back to the agent to rewrite and retry.
 */

// A connected provider's image generation, bound to its config.
export type ImageGenerator = (
	requests: GenerateImageRequest[],
	onResult?: ( index: number, result: GenerateImageResult ) => void
) => Promise< GenerateImageResult[] >;

// Prompt budget inherited from the builder: the model accepts longer prompts,
// but a tight prompt keeps the subject dominant instead of drowning it in context.
const MAX_PROMPT_TOKENS = 480;

export const IMAGE_STYLES = [
	'photorealistic',
	'digital-art',
	'illustration',
	'minimalist',
	'flat-design',
	'3d-render',
	'abstract',
	'watercolor',
] as const;

// Slot shapes; the provider maps each to the nearest canvas it renders.
export const IMAGE_ASPECT_RATIOS = [
	'square',
	'landscape',
	'ultrawide',
	'portrait',
	'card-landscape',
	'card-portrait',
] as const;

export interface ImagePromptSpec {
	subject: string;
	pageContext?: string;
	style?: string;
}

export interface ImagePromptContext {
	siteContext?: string;
	imageGrade?: string;
}

// Text-carrying objects the image model reliably completes with garbled fake
// lettering. Deliberately a noun allowlist: a false positive only adds a
// harmless render instruction, while an unconditional clause would plant the
// signage concept into clean prompts. English + Spanish, like the builder.
const TEXT_CARRIER_PATTERN =
	/\b(?:signs?|signages?|signboards?|storefronts?|shop ?fronts?|facades?|fa[çc]ades?|marquees?|billboards?|posters?|placards?|banners?|plaques?|awnings?|men[uú]s?|menu ?boards?|chalkboards?|blackboards?|whiteboards?|screens?|smartphones?|phones?|tablets?|laptops?|monitors?|dashboards?|newspapers?|magazines?|books?|labels?|packagings?|record ?sleeves?|album ?covers?|letreros?|carteles?|pancartas?|r[oó]tulos?|vallas?|marquesinas?|toldos?|pizarras?|pantallas?|tel[eé]fonos?|m[oó]viles?|peri[oó]dicos?|revistas?|libros?|etiquetas?|placas?|fachadas?|portadas?|escaparates?)\b/iu;

function estimateTokens( text: string ): number {
	const trimmed = text.trim();
	if ( ! trimmed ) {
		return 0;
	}
	const words = trimmed.split( /\s+/ ).length;
	return Math.max( Math.ceil( words * 1.4 ), Math.ceil( trimmed.length / 4 ) );
}

// Trim from the end on word boundaries; the subject leads the prompt, so this
// sheds trailing context first and preserves the subject.
export function fitToTokens( text: string, maxTokens: number ): string {
	if ( estimateTokens( text ) <= maxTokens ) {
		return text;
	}
	const words = text.trim().split( /\s+/ );
	while ( words.length && estimateTokens( words.join( ' ' ) ) > maxTokens ) {
		words.pop();
	}
	return words.join( ' ' ).replace( /[ ,.;:—-]+$/, '' );
}

/**
 * Compose the text prompt for one image. Subject and style are what the model
 * renders; the site-wide grade is a render instruction shared by all imagery so
 * independently generated images read as one photographic series; page and site
 * context only steer subject choice, mood, and composition — the guidance frame
 * states so explicitly, and the no-text guard describes reserved regions
 * positively (continuous empty scenery) rather than enumerating forbidden text
 * artifacts, which image models follow unreliably as negations.
 */
export function composeImagePrompt(
	spec: ImagePromptSpec,
	context: ImagePromptContext = {}
): string {
	const subject = spec.subject.trim();
	const style = spec.style?.trim() ?? '';
	const pageContext = spec.pageContext?.trim().replace( /\.$/, '' ) ?? '';
	const siteContext = context.siteContext?.trim() ?? '';
	const imageGrade = context.imageGrade?.trim() ?? '';

	const parts = [ style ? `${ subject }. Style: ${ style }` : subject ];

	if ( imageGrade ) {
		parts.push( `Art direction for all site imagery: ${ imageGrade.replace( /\.$/, '' ) }.` );
	}

	if ( TEXT_CARRIER_PATTERN.test( subject ) ) {
		parts.push(
			'Any sign, board, screen or printed surface in the scene is quiet set dressing: its face is unmarked — bare wood, clear glass, dark glass or blank chalk — or kept so distant, obliquely angled or softly out of focus that it reads as simple shapes, glare and texture, and the image tells its story through form, light and color alone.'
		);
	}

	const where = [ pageContext ? `Composition: ${ pageContext }.` : '', siteContext ]
		.filter( Boolean )
		.join( ' ' );
	if ( where ) {
		parts.push(
			'Purely pictorial imagery: every part of the frame is the scene itself, and any region described below as open, calm or low-detail is continuous unbroken scenery — open sky, plain wall, still water, bare ground or soft-focus depth — left completely empty. The notes below steer subject, mood and composition only and are never depicted literally: ' +
				where
		);
	}

	return fitToTokens( parts.join( '\n\n' ), MAX_PROMPT_TOKENS );
}
