"""Source-preservation regressions; run with managed Tukevejtso Python/Pillow."""
import copy
import contextlib
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

    def test_default_curated_profile_retains_55_frames_and_24_verified_strips(self):
        (self.source / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        before = self.snapshot()
        with contextlib.redirect_stdout(io.StringIO()):
            NORMALIZER.normalize(self.source, self.output, 66000, "fixture-revision", "fixture-originals")
        self.assertEqual(self.snapshot(), before)
        manifest = json.loads((self.output / "manifest.json").read_text())
        report = json.loads((self.output / "mass-normalization.json").read_text())
        self.assertEqual(len(manifest["frames"]), 55)
        self.assertEqual(len(manifest["exports"]["direction_strips"]), 24)
        self.assertEqual(report["profile"], "curated")
        self.assertEqual(report["flight_lift"], 32)
        self.assertEqual(report["warnings"], [])
        for strip in manifest["exports"]["direction_strips"]:
            expected_cells = {"walk": 5, "run": 7, "all": 11}[strip["action"]]
            self.assertEqual(len(strip["frame_ids"]), expected_cells)
            with Image.open(self.output / strip["file"]) as encoded:
                self.assertEqual(encoded.size, (512 * expected_cells, 512))


class VideoDraftNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="caatuu-video-volume-")
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / "registered"
        self.output = Path(self.temporary.name) / "normalized"
        (self.source / "images").mkdir(parents=True)
        frames = []
        for direction_index, direction in enumerate(("S", "SW", "E", "NE", "N")):
            for phase in range(9):
                action = "idle" if phase == 0 else "walk"
                identity = f"{direction}-idle" if phase == 0 else f"{direction}-walk-{phase:02d}"
                relative = f"images/{identity.lower()}{'-v1' if phase == 0 else ''}.png"
                # Different pose areas deliberately survive a shared cycle factor.
                width, height = 220 + direction_index * 8 + phase * 3, 270 + phase * 4
                image = Image.new("RGBA", (512, 512))
                left = 256 - width // 2
                image.paste((30, 140, 180, 255), (left, 480 - height, left + width, 480))
                image.save(self.source / relative)
                frames.append({"id": identity, "direction": direction, "action": action, "phase": phase,
                               "slot": phase, "file": relative,
                               "sha256": NORMALIZER.sha256(self.source / relative),
                               "registration": {"head_anchor_x": 256, "flight_lift": 0}})
        origins = {"S": "S", "SW": "SW", "E": "E", "NE": "NE", "N": "N", "W": "E", "SE": "SW", "NW": "NE"}
        self.manifest = {"frames": frames, "review": {}, "directions": [
            {"id": direction, "source": origin, "mirror": direction != origin}
            for direction, origin in origins.items()]}

    def snapshot(self):
        return {path.relative_to(self.source).as_posix(): NORMALIZER.sha256(path)
                for path in self.source.rglob("*") if path.is_file()}

    def run_normalization(self, target=66000, profile="video-walk-draft"):
        (self.source / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        before = self.snapshot()
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                NORMALIZER.normalize(self.source, self.output, target, "fixture-revision", "fixture-originals", profile)
        finally:
            self.assertEqual(self.snapshot(), before, "Normalization must preserve every source byte")

    def test_complete_draft_uses_one_factor_per_angle_including_standing_and_exports_exact_mirrors(self):
        self.run_normalization()
        report = json.loads((self.output / "mass-normalization.json").read_text())
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual(len(report["frames"]), 45)
        self.assertEqual(len(report["groups"]), 5)
        self.assertEqual(report["warnings"], [])
        for group in report["groups"]:
            records = [frame for frame in report["frames"] if frame["id"] in group["frame_ids"]]
            self.assertEqual(len(records), 9)
            self.assertEqual(len({frame["scale"] for frame in records}), 1)
            self.assertTrue(any(frame["id"].endswith("-idle") for frame in records))
            self.assertLess(abs(group["result_median_area"] - 66000) / 66000, .01)
            self.assertGreater(len({frame["result_area"] for frame in records}), 1)
        strips = manifest["exports"]["direction_strips"]
        self.assertEqual(len(strips), 8)
        for strip in strips:
            self.assertEqual(len(strip["frame_ids"]), 9)
            encoded = Image.open(self.output / strip["file"])
            for index, identity in enumerate(strip["frame_ids"]):
                frame = next(frame for frame in manifest["frames"] if frame["id"] == identity)
                expected = Image.open(self.output / frame["file"])
                if strip["mirror"]:
                    expected = expected.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                self.assertEqual(encoded.crop((index * 512, 0, (index + 1) * 512, 512)).tobytes(), expected.tobytes())

    def test_curated_profile_does_not_accept_the_different_draft_contract(self):
        with self.assertRaisesRegex(ValueError, "complete 55-frame"):
            self.run_normalization(profile="curated")
        self.assertFalse(self.output.exists())

    def test_draft_preserves_southwest_source_instead_of_curated_southeast_source(self):
        next(entry for entry in self.manifest["directions"] if entry["id"] == "SE").update(source="E")
        with self.assertRaisesRegex(ValueError, "Incorrect source or mirror"):
            self.run_normalization()
        self.assertFalse(self.output.exists())

    def test_clipping_is_rejected_before_creating_any_output(self):
        with self.assertRaisesRegex(ValueError, "Insufficient canvas margin"):
            self.run_normalization(target=500000)
        self.assertFalse(self.output.exists())

    def test_shrinking_a_thin_alpha_foot_tip_keeps_the_actual_ground_anchor(self):
        frame = self.manifest["frames"][0]
        path = self.source / frame["file"]
        image = Image.open(path).copy()
        left = image.getchannel("A").getbbox()[0]
        image.paste((0, 0, 0, 0), (0, 479, 512, 480))
        image.putpixel((left + 1, 479), (30, 140, 180, 2))
        image.save(path)
        frame["sha256"] = NORMALIZER.sha256(path)
        self.run_normalization(target=33000)
        result = Image.open(self.output / frame["file"])
        self.assertEqual(result.getchannel("A").getbbox()[3], 480)
        report = json.loads((self.output / "mass-normalization.json").read_text())
        adjusted = next(record for record in report["frames"] if record["id"] == frame["id"])
        self.assertGreater(adjusted["resampled_anchor_adjustment_y"], 0)


if __name__ == "__main__":
    unittest.main()
