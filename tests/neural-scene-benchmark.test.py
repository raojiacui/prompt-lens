import importlib.util
import unittest
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("neural_benchmark", Path(__file__).resolve().parents[1] / "scripts/neural-scene-benchmark.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class NeuralBenchmarkTests(unittest.TestCase):
    def test_windows_reconstruct_every_frame_without_padding(self):
        for count in [1, 49, 50, 51, 100, 103]:
            frames = np.arange(count).reshape(count, 1, 1, 1)
            windows = list(benchmark.windows(frames))
            self.assertTrue(all(len(window) == 100 for window in windows))
            reconstructed = np.concatenate([window[25:75] for window in windows])[:count]
            np.testing.assert_array_equal(reconstructed, frames)
            self.assertEqual(windows[0][0, 0, 0, 0], 0)
            self.assertEqual(windows[-1][-1, 0, 0, 0], count - 1)

    def test_empty_video_is_rejected(self):
        with self.assertRaises(ValueError):
            list(benchmark.windows(np.empty((0, 1, 1, 1))))

    def test_transition_run_is_one_midpoint_cut(self):
        self.assertEqual(benchmark.probability_cuts([0, 0.9, 0.9, 0, 0.8], 0.5, 10), [0.15, 0.4])

    def test_strict_threshold_matches_upstream(self):
        self.assertEqual(benchmark.probability_cuts([0.5, 0.6, 0.5], 0.5, 10), [0.1])

    def test_score_keeps_holdout_separate_and_excludes_video_edges(self):
        result = benchmark.score([0.3, 1, 1, 8, 9.8], [1, 8], 10)
        self.assertEqual(result["cuts"], [1, 8])
        self.assertEqual(result["all"]["hits"], 2)
        self.assertEqual(result["tuning"]["hits"], 1)
        self.assertEqual(result["holdout"]["hits"], 1)

    def test_long_shot_repair_does_not_force_fixed_length_cuts(self):
        self.assertEqual(benchmark.long_shot_repair([5, 25], [2, 10, 10.1, 24.8, 27], 30), [5, 10, 25])
        self.assertEqual(benchmark.long_shot_repair([], [], 35), [])

    def test_fifteen_seconds_is_not_rechecked(self):
        self.assertEqual(benchmark.long_shot_repair([15], [5, 20], 30), [15])

    def test_transition_midpoint_removes_two_edges_and_padding(self):
        cuts = [{"pos": 10, "intra_label": 1}, {"pos": 20, "intra_label": 0},
                {"pos": 30, "intra_label": 8}, {"pos": 40, "intra_label": 0}]
        variants = benchmark.omni_cut_variants(cuts, 10)
        self.assertEqual(variants["upstream-all-transitions"], [1, 2, 3, 4])
        self.assertEqual(variants["general-shot-starts"], [2, 4])
        self.assertEqual(variants["transition-midpoints-no-padding"], [1.5, 4])

    def test_consensus_does_not_average_in_a_distant_model(self):
        self.assertEqual(benchmark.consensus_cuts([[10], [10.1], [30]]), [10.05])

    def test_one_model_cannot_vote_twice(self):
        self.assertEqual(benchmark.consensus_cuts([[10, 10.1], [], [30]]), [])

    def test_consensus_deduplicates_nearby_votes(self):
        self.assertEqual(benchmark.consensus_cuts([[10, 20], [10.1, 20.1], [10.2]]), [10.1, 20.05])


if __name__ == "__main__":
    unittest.main()
