export function poorAnchor(name, unlock = name) {
  return Object.freeze({ name, unlock });
}

export function poorAnchorInput(anchor) {
  return typeof anchor === "string" ? anchor : anchor.unlock;
}

export function poorAnchorLabel(anchor) {
  if (typeof anchor === "string" || anchor.name === anchor.unlock) {
    return typeof anchor === "string" ? anchor : anchor.name;
  }
  return `${anchor.name} (via ${anchor.unlock})`;
}

export function activePoorAnchors(anchors, bucket) {
  const attainable = new Set(bucket);
  return anchors.filter((anchor) =>
    attainable.has(poorAnchorInput(anchor)),
  );
}
