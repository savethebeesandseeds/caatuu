"""Source-preservation regressions; run with managed Tukevejtso Python/Pillow."""
import copy
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "normalize-motion.py"
SPEC = importlib.util.spec_from_file_location("normalize_motion", MODULE_PATH)
NORMALIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NORMALIZER)


class NormalizePreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pngs = {}
        for lift in (0, 32):
            image = Image.new("RGBA", (512, 512))
            image.paste((30, 140, 180, 255), (128, 224 - lift, 384, 480 - lift))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            cls.pngs[lift] = buffer.getvalue()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="caatuu-normalize-preflight-")
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / "originals"
        self.output = Path(self.temporary.name) / "normalized"
        (self.source / "images").mkdir(parents=True)
        self.sentinel = self.source / "source-sentinel.txt"
        self.sentinel_bytes = b"Preserved original source. Never replace or modify.\n"
        self.sentinel.write_bytes(self.sentinel_bytes)
        frames = []
        for direction in ("S", "N", "E", "SE", "NE"):
            for action, phases in (("idle", (0,)), ("walk", range(1, 5)), ("run", range(1, 7))):
                for phase in phases:
                    identity = f"{direction}-idle" if action == "idle" else f"{direction}-{action}-{phase:02d}"
                    relative = f"images/{identity.lower()}-sheet-v1.png"
                    lift = 32 if action == "run" and phase in (3, 6) else 0
                    data = self.pngs[lift]
                    (self.source / relative).write_bytes(data)
                    frames.append({"id": identity, "direction": direction, "action": action, "phase": phase,
                                   "file": relative, "sha256": hashlib.sha256(data).hexdigest(),
                                   "registration": {"head_anchor_x": 256, "flight_lift": lift}})
        origins = {"S": "S", "N": "N", "E": "E", "SE": "SE", "NE": "NE", "W": "E", "SW": "SE", "NW": "NE"}
        self.manifest = {"frames": frames, "review": {},
                         "directions": [{"id": direction, "source": origin, "mirror": direction != origin}
                                        for direction, origin in origins.items()]}

    def snapshot(self):
        return {path.relative_to(self.source).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in self.source.rglob("*") if path.is_file()}

    def assert_rejected(self, mutate, message, output=None):
        manifest = copy.deepcopy(self.manifest)
        mutate(manifest)
        (self.source / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        before = self.snapshot()
        destination = output if output is not None else self.output
        self.assertFalse(destination.exists(), "The candidate output starts absent")
        with self.assertRaisesRegex(ValueError, message):
            NORMALIZER.normalize(self.source, destination, 66000, "fixture-revision", "fixture-originals")
        self.assertFalse(destination.exists(), "Rejected inputs must not create output")
        self.assertEqual(self.sentinel.read_bytes(), self.sentinel_bytes)
        self.assertEqual(self.snapshot(), before, "Every preserved source byte must stay unchanged")

    def test_absolute_source_filename_is_rejected_without_overwriting_it(self):
        original = (self.source / self.manifest["frames"][0]["file"]).resolve()
        self.assert_rejected(lambda manifest: manifest["frames"][0].update(file=str(original)),
                             "Unsafe or duplicate frame path")

    def test_traversal_resolving_back_into_source_is_rejected(self):
        relative = self.manifest["frames"][0]["file"]
        # This resolves to a valid, hash-matching input but would escape a sibling output root.
        alias = f"../originals/{relative}"
        self.assertEqual((self.source / alias).resolve(), (self.source / relative).resolve())
        self.assert_rejected(lambda manifest: manifest["frames"][0].update(file=alias),
                             "Unsafe or duplicate frame path")

    def test_output_nested_in_source_is_rejected_before_directory_creation(self):
        self.assert_rejected(lambda manifest: None, "must not overlap",
                             output=self.source / "images" / ".." / "candidate")

    def test_missing_direction_mapping_is_rejected_before_output(self):
        self.assert_rejected(lambda manifest: manifest["directions"].pop(),
                             "exactly eight canonical direction mappings")

    def test_wrong_or_non_boolean_mirror_is_rejected(self):
        for mirror in (False, 1, "true"):
            with self.subTest(mirror=mirror):
                self.assert_rejected(lambda manifest: next(entry for entry in manifest["directions"]
                                                          if entry["id"] == "W").update(mirror=mirror),
                                     "Incorrect source or mirror")

    def test_wrong_direction_source_is_rejected(self):
        self.assert_rejected(lambda manifest: next(entry for entry in manifest["directions"]
                                                  if entry["id"] == "NW").update(source="E"),
                             "Incorrect source or mirror")

    def test_frame_metadata_must_match_its_id_before_output(self):
        for field, value in (("direction", "N"), ("action", "run"), ("phase", 1)):
            with self.subTest(field=field):
                self.assert_rejected(lambda manifest: manifest["frames"][0].update({field: value}),
                                     "Frame metadata mismatch: S-idle")

    def test_duplicate_frame_destination_is_rejected(self):
        self.assert_rejected(lambda manifest: manifest["frames"][1].update(file=manifest["frames"][0]["file"]),
                             "Unsafe or duplicate frame path")


if __name__ == "__main__":
    unittest.main()
