export function validateLayout(input, path = 'layout') {
  const fail = (field, detail) => {
    throw new Error(`Invalid document: ${path}${field ? `.${field}` : ''} ${detail}`);
  };
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    fail('', 'must be a plain object.');
  if (!['row', 'column'].includes(input.direction)) fail('direction', 'must be row or column.');
  if (!['start', 'center', 'end', 'stretch'].includes(input.align))
    fail('align', 'is not supported.');
  if (!['start', 'center', 'end', 'space-between'].includes(input.justify))
    fail('justify', 'is not supported.');
  const layout = { direction: input.direction, align: input.align, justify: input.justify };
  for (const field of ['gap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
    if (
      typeof input[field] !== 'number' ||
      !Number.isFinite(input[field]) ||
      input[field] < 0 ||
      input[field] > 100_000
    )
      fail(field, 'must be a finite number from 0 to 100000.');
    layout[field] = input[field];
  }
  return layout;
}

export function reflowNodes(nodes) {
  if (!nodes.some((node) => node.layout)) return nodes;
  const result = nodes.map((node) => ({ ...node }));
  const children = new Map();
  for (const node of result) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const pending = [...(children.get(null) ?? [])];
  for (let index = 0; index < pending.length; index++) {
    pending.push(...(children.get(pending[index].id) ?? []));
    if (pending.length > result.length)
      throw new Error('Invalid document: layout contains a parent cycle.');
  }
  for (const frame of [...pending].reverse()) {
    if (!frame.layout) continue;
    const items = (children.get(frame.id) ?? []).filter((node) => node.visible);
    const layout = frame.layout;
    for (const dimension of ['width', 'height']) {
      if (frame[`${dimension}Mode`] !== 'fit') continue;
      const main = (layout.direction === 'row') === (dimension === 'width');
      const content = main
        ? items.reduce((size, node) => size + node[dimension], 0) +
          layout.gap * Math.max(0, items.length - 1)
        : Math.max(0, ...items.map((node) => node[dimension]));
      const padding =
        dimension === 'width'
          ? layout.paddingLeft + layout.paddingRight
          : layout.paddingTop + layout.paddingBottom;
      frame[dimension] = Math.max(1, content + padding);
      if (!Number.isFinite(frame[dimension]) || frame[dimension] > 100_000)
        throw new Error(
          `Invalid document: fitted ${dimension} exceeds the 100000 dimension limit.`,
        );
    }
  }
  let index = 0;
  while (index < pending.length) {
    const frame = pending[index++];
    const descendants = children.get(frame.id) ?? [];

    if (!frame.layout) continue;
    const layout = frame.layout;
    const items = descendants.filter((child) => child.visible);
    if (!items.length) continue;
    const horizontal = layout.direction === 'row';
    const mainStart = horizontal ? layout.paddingLeft : layout.paddingTop;
    const crossStart = horizontal ? layout.paddingTop : layout.paddingLeft;
    const mainSpace = horizontal
      ? frame.width - layout.paddingLeft - layout.paddingRight
      : frame.height - layout.paddingTop - layout.paddingBottom;
    const crossSpace = horizontal
      ? frame.height - layout.paddingTop - layout.paddingBottom
      : frame.width - layout.paddingLeft - layout.paddingRight;
    const occupied = items.reduce(
      (size, node) => size + (horizontal ? node.width : node.height),
      0,
    );
    const remaining = mainSpace - occupied - layout.gap * (items.length - 1);
    const gap =
      layout.justify === 'space-between' && items.length > 1
        ? layout.gap + Math.max(0, remaining) / (items.length - 1)
        : layout.gap;
    let main =
      mainStart +
      (layout.justify === 'center' ? remaining / 2 : layout.justify === 'end' ? remaining : 0);
    for (const node of items) {
      if (layout.align === 'stretch') {
        if (horizontal && node.heightMode !== 'fit') node.height = Math.max(1, crossSpace);
        if (!horizontal && node.widthMode !== 'fit') node.width = Math.max(1, crossSpace);
      }
      const crossRemaining = crossSpace - (horizontal ? node.height : node.width);
      const cross =
        crossStart +
        (layout.align === 'center'
          ? crossRemaining / 2
          : layout.align === 'end'
            ? crossRemaining
            : 0);
      node.x = horizontal ? main : cross;
      node.y = horizontal ? cross : main;
      if (
        ![node.x, node.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000)
      )
        throw new Error('Invalid document: flex layout exceeds the coordinate limit.');
      main += (horizontal ? node.width : node.height) + gap;
    }
  }
  return result;
}
