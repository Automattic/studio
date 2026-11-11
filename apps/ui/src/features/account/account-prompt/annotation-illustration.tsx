import { DrawIcon, SelectIcon } from '@/lib/icons';
import styles from './annotation-illustration.module.css';
import site from './assets/site-2.png';

export function AnnotationIllustration() {
	return (
		<div aria-hidden="true" className={ styles.scene }>
			<div className={ styles.site }>
				<img src={ site } alt="" />
				<svg className={ styles.annotations } viewBox="0 0 400 300" fill="none">
					<rect x="20" y="149" width="118" height="119" rx="2" />
					<path d="M24 131C58 121 86 140 120 129S179 139 210 129C228 123 244 126 253 130" />
				</svg>
			</div>
			<div className={ styles.toolbar }>
				<span className={ styles.selectedTool }>
					<SelectIcon />
				</span>
				<span className={ styles.tool }>
					<DrawIcon />
				</span>
			</div>
		</div>
	);
}
