# Walkable-area masks

No movement masks have been drawn yet. Save masks separately from the selected
scenery, using matching section coordinates, dimensions and version references.

Use a binary grayscale PNG: white means walkable, black means blocked. Keep
the walkable boundary hard-edged, without antialiasing. Each approved mask
must identify the exact scenery version it was reviewed against in
[the world manifest](../manifest.json).

This is the planned authoring convention; no navigation importer is implemented
for these maps yet. See the [world map workflow](../../README.md).
