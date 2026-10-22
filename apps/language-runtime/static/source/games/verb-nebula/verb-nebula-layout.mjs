/** Fit only overflowing labels, preserving whole words and their reading guides. */
export function fitVerbMatchLabels(board) {
  const labels = [...(board?.querySelectorAll(".verb-match-card-copy") || [])];
  // Reset together before measuring so a wider viewport restores the chosen size.
  for (const label of labels) label.style.removeProperty("--verb-label-scale");
  const scales = labels.map(label => {
    const available = label.clientWidth;
    if (!(available > 0)) return 1;
    const required = Math.max(label.scrollWidth,
      ...[...label.querySelectorAll("ruby")].map(unit => unit.getBoundingClientRect().width));
    return required > available + 0.5 ? Math.max(0.1, (available - 1) / required) : 1;
  });
  labels.forEach((label, index) => {
    if (scales[index] < 1) label.style.setProperty("--verb-label-scale", scales[index].toFixed(4));
  });
}
