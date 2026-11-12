import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("refiner", Path(__file__).resolve().parents[1] / "workers/ffmpeg-worker/scene-refine.py")
refiner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refiner)


class EmptyFrameTests(unittest.TestCase):
    def test_black_and_white_with_codec_noise_are_empty(self):
        for value in (0, 255):
            frame = np.full((180, 320, 3), value, np.uint8)
            self.assertTrue(refiner.is_empty_frame(frame))
            frame[4, 8] = 10 if value == 0 else 245
            self.assertTrue(refiner.is_empty_frame(frame))

    def test_text_and_small_logo_on_black_or_white_are_content(self):
        for value, ink in ((0, 255), (255, 0)):
            frame = np.full((180, 320, 3), value, np.uint8)
            cv2.putText(frame, "Title", (30, 90), cv2.FONT_HERSHEY_SIMPLEX, 1, (ink,) * 3, 2)
            self.assertFalse(refiner.is_empty_frame(frame))
            frame[:] = value
            frame[20:22, 20:22] = ink
            self.assertFalse(refiner.is_empty_frame(frame))

    def test_dark_high_key_and_colored_frames_are_content(self):
        for lo, hi in ((0, 12), (243, 255)):
            gray = np.tile(np.linspace(lo, hi, 320, dtype=np.uint8), (180, 1))
            self.assertFalse(refiner.is_empty_frame(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)))
        self.assertFalse(refiner.is_empty_frame(np.full((180, 320, 3), (255, 0, 0), np.uint8)))


class ContinuityTests(unittest.TestCase):
    @staticmethod
    def texture(seed):
        gray = np.random.default_rng(seed).integers(0, 256, (180, 320), dtype=np.uint8)
        gray = cv2.GaussianBlur(gray, (9, 9), 0)
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    def test_continuous_camera_motion_is_confirmed(self):
        before = self.texture(1)
        after = cv2.warpAffine(before, np.float32([[1, 0, 1], [0, 1, 0]]), (320, 180), borderMode=cv2.BORDER_REFLECT)
        self.assertTrue(refiner.has_motion_continuity(before, after))

    def test_similar_histograms_do_not_merge_unrelated_shots(self):
        self.assertFalse(refiner.has_motion_continuity(self.texture(1), self.texture(2)))

    def test_shared_background_does_not_hide_changed_subject(self):
        before = self.texture(1)
        after = before.copy()
        after[25:155, 70:250] = 0
        self.assertFalse(refiner.has_motion_continuity(before, after))

    def test_featureless_pure_frames_cannot_prove_continuity(self):
        blank = np.zeros((180, 320, 3), np.uint8)
        self.assertFalse(refiner.has_motion_continuity(blank, blank))


class IntervalTests(unittest.TestCase):
    def test_blank_gaps_are_not_filled_or_time_compressed(self):
        result = refiner.useful_intervals([1, 2, 3, 4], [(0, 0.3), (2, 3), (4.5, 5)], 5)
        self.assertEqual(result, [{"start": .3, "end": 1}, {"start": 1, "end": 2}, {"start": 3, "end": 4}, {"start": 4, "end": 4.5}])

    def test_short_real_shots_survive_but_transition_slivers_merge(self):
        result = refiner.useful_intervals([.58, 1.08], [(1.16, 2)], 2)
        self.assertEqual(result, [{"start": 0, "end": .58}, {"start": .58, "end": 1.16}])
        self.assertEqual(refiner.useful_intervals([], [(0, 2)], 2), [])

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is required")
    def test_actual_decoding_excludes_only_empty_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "blinks.mkv")
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=0.5", "-f", "lavfi", "-i", "color=black:size=320x180:rate=24:duration=0.25", "-f", "lavfi", "-i", "color=white:size=320x180:rate=24:duration=0.25", "-filter_complex", "[0:v][1:v][2:v][0:v]concat=n=4:v=1:a=0[v]", "-map", "[v]", "-c:v", "ffv1", path], check=True)
            result = refiner.refine_video(path, [.5, .75, 1], 1.5)
            self.assertEqual(result["decodedFrames"], 36)
            self.assertEqual(result["scenes"], [{"start": 0, "end": .5}, {"start": 1, "end": 1.5}])
            self.assertEqual(result["removedCuts"], [])


if __name__ == "__main__":
    unittest.main()
