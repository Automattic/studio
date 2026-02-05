export const VipIcon = ( { size = 32 }: { size?: number } ) => (
	<svg
		width={ size }
		height={ size }
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		{ /* VIP Logo - stylized V shape with enterprise cloud feel */ }
		<path
			d="M4 6L8.5 16H9.5L14 6"
			stroke="#0675C4"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path d="M16 6V16" stroke="#0675C4" strokeWidth="2" strokeLinecap="round" />
		<path
			d="M20 6H16V10H19"
			stroke="#0675C4"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export const VipBadge = ( { className }: { className?: string } ) => (
	<span
		className={ `inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#0675C4] text-white uppercase ${
			className ?? ''
		}` }
	>
		VIP
	</span>
);
