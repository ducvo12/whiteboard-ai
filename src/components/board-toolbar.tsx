"use client";

import { DefaultToolbar, ToolbarItem, TldrawUiMenuItem, useEditor } from 'tldraw';
import { createPolygon } from '@/lib/whiteboard/create-polygon';

// Keep the native tools and overflow behavior, with polygon beside the arrow tool.
const beforePolygon = ['select', 'hand', 'draw', 'eraser', 'arrow'];
const afterPolygon = ['text', 'note', 'asset', 'rectangle', 'ellipse', 'triangle', 'diamond',
  'hexagon', 'oval', 'rhombus', 'star', 'cloud', 'heart', 'x-box', 'check-box',
  'arrow-left', 'arrow-up', 'arrow-down', 'arrow-right', 'line', 'highlight', 'laser', 'frame'];

export function BoardToolbar() {
  const editor = useEditor();
  return <DefaultToolbar>
    {beforePolygon.map(tool => <ToolbarItem key={tool} tool={tool} />)}
    <TldrawUiMenuItem id="insert-polygon" label="Polygon" icon="geo-pentagon"
      onSelect={() => createPolygon(editor)} />
    {afterPolygon.map(tool => <ToolbarItem key={tool} tool={tool} />)}
  </DefaultToolbar>;
}
