import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ReactNode } from 'react';

// The mock site in the sign-in playbacks: a quiet personal blog, rendered
// opposite to the app's scheme (dark page in light mode and vice versa) so it
// reads as a site, not as more UI. Scenes animate the agent's changes through
// the props and layer their own overlays (highlights, markers) as children.

export const BLOG_PAGE_BG_ON_LIGHT = '#1e3a2f';
export const BLOG_PAGE_BG_ON_DARK = '#eef4ee';

export const BLOG_HEADING = __( 'Notes from a small studio.' );
export const BLOG_CTA = __( 'Subscribe' );
export const BLOG_POSTS = [
	{
		date: 'Mar 14',
		title: __( 'Learning to letterpress' ),
		excerpt: __( 'A weekend with ink, type, and a very patient press.' ),
	},
	{
		date: 'Feb 28',
		title: __( 'A week without notifications' ),
		excerpt: __( 'What changed when my phone finally went quiet.' ),
	},
	{
		date: 'Feb 11',
		title: __( 'Rebuilding my desk setup' ),
		excerpt: __( 'Fewer things, better placed, and a lot more light.' ),
	},
];

export function BlogPage( {
	headingProgress = 0,
	ctaAccent = false,
	excerptProgress = [ 0, 0, 0 ],
	children,
}: {
	/** 0→1: the heading growing bigger and bolder. */
	headingProgress?: number;
	/** The Subscribe button in the site's green. */
	ctaAccent?: boolean;
	/** 0→1 per post: its excerpt opening under the title. */
	excerptProgress?: number[];
	children?: ReactNode;
} ) {
	return (
		<div className={ styles.annoPage }>
			<span className={ styles.annoSiteTitle }>Ada Lin</span>
			<span
				className={ styles.annoHeading }
				style={ {
					fontSize: 24 + 5 * headingProgress,
					fontWeight: headingProgress > 0.5 ? 800 : 700,
					letterSpacing: `${ -0.015 - 0.01 * headingProgress }em`,
				} }
			>
				{ BLOG_HEADING }
			</span>
			<span className={ styles.annoLead }>
				{ __(
					'I’m Ada, a designer in Portland. This is where I write about craft, tools, and slow work.'
				) }
			</span>
			<span className={ clsx( styles.annoCta, ctaAccent && styles.annoCtaAccent ) }>
				{ BLOG_CTA }
			</span>
			<span className={ styles.annoSectionLabel }>{ __( 'Latest posts' ) }</span>
			<div className={ styles.annoPosts }>
				{ BLOG_POSTS.map( ( post, index ) => (
					<span key={ post.title } className={ styles.annoPost }>
						<span className={ styles.annoPostDate }>{ post.date }</span>
						<span className={ styles.annoPostBody }>
							<span className={ styles.annoPostTitle }>{ post.title }</span>
							<span
								className={ styles.annoPostExcerpt }
								style={ {
									opacity: excerptProgress[ index ] ?? 0,
									maxHeight: ( excerptProgress[ index ] ?? 0 ) * 16,
								} }
							>
								{ post.excerpt }
							</span>
						</span>
					</span>
				) ) }
			</div>
			{ children }
		</div>
	);
}
