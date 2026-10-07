import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("benchmark", Path(__file__).resolve().parents[1] / "scripts/scene-detection-benchmark.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BoundaryMatchingTests(unittest.TestCase):
    def test_one_prediction_cannot_match_two_markers(self):
        result = benchmark.match_boundaries([1, 1.2], [1.1], 0.5)
        self.assertEqual(result["hits"], 1)
        self.assertEqual(len(result["missed"]), 1)

    def test_maximizes_matches_before_minimizing_error(self):
        result = benchmark.match_boundaries([1, 1.5], [0.6, 1.1], 0.5)
        self.assertEqual(result["hits"], 2)

    def test_reports_signed_offsets_and_extra_boundaries(self):
        result = benchmark.match_boundaries([1, 5], [1.2, 3], 0.5)
        self.assertEqual(result["missed"], [5])
        self.assertEqual(result["extra"], [3])
        self.assertEqual(result["matches"][0]["offset"], 0.2)

    def test_empty_predictions_have_zero_recall(self):
        result = benchmark.match_boundaries([1], [], 0.5)
        self.assertEqual(result["f1"], 0)
        self.assertEqual(result["missed"], [1])

    def test_minimizes_offset_when_match_counts_are_equal(self):
        result = benchmark.match_boundaries([1], [0.6, 1.05], 0.5)
        self.assertEqual(result["matches"][0]["cut"], 1.05)

    def test_detector_defaults_and_explicit_parameters(self):
        worker_spec = importlib.util.spec_from_file_location("worker", Path(__file__).resolve().parents[1] / "workers/ffmpeg-worker/scene-detect.py")
        worker = importlib.util.module_from_spec(worker_spec)
        worker_spec.loader.exec_module(worker)
        default = worker.build_detector("adaptive", 27, 3, 14)
        self.assertEqual(default.min_content_val, 15)
        self.assertEqual(default.window_width, 2)
        candidate = worker.build_detector("adaptive", 27, 2, 14, 8, 12)
        self.assertEqual(candidate.min_content_val, 8)
        self.assertEqual(candidate.window_width, 12)

    def test_reads_point_markers_and_relative_resource(self):
        xml = """<mlt><chain id="source"><property name="resource">clip.mp4</property></chain>
        <playlist id="playlist0"><entry producer="source" in="00:00:00.000"/></playlist>
        <properties name="shotcut:markers"><properties name="0">
        <property name="start">00:00:03.250</property><property name="end">00:00:03.250</property>
        </properties></properties></mlt>"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.mlt"
            path.write_text(xml)
            video, markers = benchmark.read_project(path)
            self.assertEqual(video, Path(directory) / "clip.mp4")
            self.assertEqual(markers, [3.25])
            path.write_text(xml.replace('in="00:00:00.000"', 'in="00:00:01.000"'))
            with self.assertRaises(ValueError):
                benchmark.read_project(path)


if __name__ == "__main__":
    unittest.main()
