# Inner Blocks

Use the InnerBlocks component from @wordpress/block-editor as much as possible.
- Import InnerBlocks and useBlockProps from @wordpress/block-editor
- A block can only contain ONE InnerBlocks component
- Always wrap InnerBlocks in a div with blockProps spread: `<div {...blockProps}><InnerBlocks /></div>`
- Use the allowedBlocks prop to restrict which blocks can be inserted as children
- Set orientation="horizontal" when inner blocks are displayed horizontally
- Use template prop to define a pre-filled block structure
- Combine template with templateLock="all" to prevent any changes, or templateLock="insert" to prevent additions but allow reordering
- Use defaultBlock with directInsert={true} to auto-insert a specific block type when the appender is clicked
- Define block relationships in block.json: use parent for direct descendants only, ancestor for any level
- For advanced cases, consider useInnerBlocksProps hook instead of the component
