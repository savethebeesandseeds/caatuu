# Macaw controlled-foot rig prototype

This folder tests deterministic browser animation without asking an image model
to redraw the whole character on every frame.

`macaw-walk_005.png` is separated into a stable body plus near and far foot
layers. The browser moves those two foot layers along a distance-driven gait:
each foot has a planted support phase, a lifted swing phase, and a short arrival
transition back to the neutral standing pose.

The masks and pivots are recorded in `rig.json`. `macaw-rig-preview.png` shows
the source, isolated layers, and neutral recomposition on a checkerboard.

Build the PNG layers with the existing Tukevejtso container and its managed
Pillow environment. Do not run the builder with a host Python installation:

```text
docker cp build_rig_assets.py tukevejtso:/tmp/build_rig_assets.py
docker cp ../side/macaw-walk_005.png tukevejtso:/tmp/macaw-walk_005.png
docker exec tukevejtso /opt/tukevejtso-venvs/cutout/bin/python \
  /tmp/build_rig_assets.py /tmp/macaw-walk_005.png /tmp/macaw-rig
```

The active browser comparison is under
`/demos/world-movement/`: **Controlled feet** uses this rig and
**Generated frames** preserves the earlier eight-image cycle for comparison.
