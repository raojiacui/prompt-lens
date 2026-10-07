"""Offline CPU comparison using upstream architectures and explicit checkpoints."""
import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


benchmark = load_module("scene_benchmark", Path(__file__).with_name("scene-detection-benchmark.py"))


def windows(frames):
    import numpy as np
    if len(frames) == 0:
        raise ValueError("No decoded frames.")
    tail = (-len(frames)) % 50
    padded = np.concatenate([np.repeat(frames[:1], 25, axis=0), frames,
                             np.repeat(frames[-1:], tail + 25, axis=0)])
    for start in range(0, len(frames), 50):
        yield padded[start:start + 100]


def probability_cuts(probabilities, threshold, fps):
    """Represent each contiguous transition range by its midpoint, not two cuts."""
    cuts, start = [], None
    for index, probability in enumerate(list(probabilities) + [0]):
        if probability > threshold and start is None:
            start = index
        elif probability <= threshold and start is not None:
            cuts.append(round((start + index - 1) / 2 / fps, 3))
            start = None
    return cuts


def score(cuts, markers, duration):
    cuts = sorted(set(cut for cut in cuts if 0.6 < cut < duration - 0.6))
    split = duration * 2 / 3
    return {"cuts": cuts, "all": benchmark.match_boundaries(markers, cuts, 0.5),
            "tuning": benchmark.match_boundaries([x for x in markers if x < split],
                                                 [x for x in cuts if x < split], 0.5),
            "holdout": benchmark.match_boundaries([x for x in markers if x >= split],
                                                  [x for x in cuts if x >= split], 0.5)}


def long_shot_repair(baseline, candidates, duration, limit=15, minimum=0.6):
    """Offline simulation using cached full-video predictions, not cropped inference."""
    retained = sorted(set(cut for cut in baseline if 0 < cut < duration))
    bounds = [0] + retained + [duration]
    for start, end in zip(bounds, bounds[1:]):
        if end - start <= limit:
            continue
        for cut in sorted(set(candidates)):
            if start + minimum < cut < end - minimum and all(abs(cut - old) >= minimum for old in retained):
                retained.append(cut)
    return sorted(retained)


def omni_cut_variants(labeled_cuts, fps):
    raw = [cut["pos"] / fps for cut in labeled_cuts]
    general = [cut["pos"] / fps for cut in labeled_cuts if cut["intra_label"] == 0]
    # A transition is a span between general shots, not an extra independent shot.
    midpoint, pending = [], None
    for cut in labeled_cuts:
        if cut["intra_label"] in range(1, 8):
            if pending is None:
                pending = cut["pos"]
        elif cut["intra_label"] == 0:
            midpoint.append(((pending + cut["pos"]) / 2 if pending is not None else cut["pos"]) / fps)
            pending = None
        else:
            pending = None
    return {"upstream-all-transitions": raw, "general-shot-starts": general,
            "transition-midpoints-no-padding": midpoint}


def consensus_cuts(predictions, tolerance=0.5, minimum=0.6):
    candidates = []
    for cut in sorted({cut for source in predictions for cut in source}):
        votes = []
        for source in predictions:
            if source:
                nearest = min(source, key=lambda point: abs(point - cut))
                if abs(nearest - cut) <= tolerance:
                    votes.append(nearest)
        if len(votes) >= 2:
            candidates.append(sum(votes) / len(votes))
    retained = []
    for cut in sorted(candidates):
        if not retained or cut - retained[-1] >= minimum:
            retained.append(round(cut, 3))
    return retained


def decode(path, width, height):
    import numpy as np
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-an",
                             "-vf", f"scale={width}:{height}", "-vsync", "0",
                             "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                            capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, height, width, 3).copy()


def tiny_inference(args, video, torch):
    import numpy as np
    if args.model == "transnet":
        module = load_module("transnet_model", args.repo / "inference-pytorch/transnetv2_pytorch.py")
        model = module.TransNetV2()
    else:
        sys.path.insert(0, str(args.repo.resolve()))
        module = load_module("autoshot_model", args.repo / "supernet_flattransf_3_8_8_8_13_12_0_16_60.py")
        model = module.TransNetV2Supernet()
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state["net"] if args.model == "autoshot" else state, strict=True)
    model.eval()
    frames = decode(video, 48, 27)
    predictions, transitions = [], []
    count = (len(frames) + 49) // 50
    with torch.inference_mode():
        for index, batch in enumerate(windows(frames)):
            tensor = torch.from_numpy(batch[None])
            if args.model == "autoshot":
                tensor = tensor.permute(0, 4, 1, 2, 3).float()
            output = model(tensor)
            if isinstance(output, tuple):
                output, many_hot = output
                if isinstance(many_hot, dict):
                    many_hot = many_hot["many_hot"]
                transitions.append(torch.sigmoid(many_hot)[0, 25:75].cpu().numpy().reshape(-1))
            predictions.append(torch.sigmoid(output)[0, 25:75].cpu().numpy().reshape(-1))
            if index % 20 == 0 or index + 1 == count:
                print(f"{args.model}: {index + 1}/{count} windows", flush=True)
    heads = {"one_hot": np.concatenate(predictions)[:len(frames)]}
    if transitions:
        heads["many_hot"] = np.concatenate(transitions)[:len(frames)]
    return heads, len(frames)


def omni_inference(args, video, torch):
    sys.path.insert(0, str(args.repo.resolve()))
    from omnishotcut import engine
    from omnishotcut.architecture import backbone
    from omnishotcut.architecture.transformer import build_transformer
    from omnishotcut.architecture.model import OmniShotCut
    with torch.serialization.safe_globals([argparse.Namespace]):
        state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model_args = state["args"]
    # The complete checkpoint replaces ImageNet weights; avoid an unnecessary download.
    backbone.is_main_process = lambda: False
    model = OmniShotCut(backbone.build_backbone(model_args), build_transformer(model_args),
                       num_intra_relation_classes=model_args.num_intra_relation_classes,
                       num_inter_relation_classes=model_args.num_inter_relation_classes,
                       num_frames=model_args.max_process_window_length,
                       num_queries=model_args.num_queries, aux_loss=model_args.aux_loss)
    model.load_state_dict(state["model"], strict=True)
    model.eval()
    frames = decode(video, model_args.process_width, model_args.process_height)
    chunks = engine.split_videos(frames, model_args.max_process_window_length, 10)
    cuts = []
    with torch.inference_mode():
        for index, (chunk, _, start, valid_start, valid_end, valid_len) in enumerate(chunks):
            outputs = model(engine.video_transform(chunk).unsqueeze(0))
            intra = outputs["intra_clip_logits"].softmax(-1)[0, :, :-1].argmax(-1)
            inter = outputs["inter_clip_logits"].softmax(-1)[0, :, :-1].argmax(-1)
            ranges = outputs["pred_shot_logits"].softmax(-1)[0, :, :-1].argmax(-1)
            segments = engine.decode_window_segments(intra, inter, ranges, valid_len)
            cuts.extend(engine.collect_cuts_from_window(segments, start, valid_start, valid_end))
            if index % 10 == 0 or index + 1 == len(chunks):
                print(f"omni: {index + 1}/{len(chunks)} windows", flush=True)
    return cuts, len(frames)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["transnet", "autoshot", "omni"], required=True)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--baseline", type=Path, help="PySceneDetect report for cached long-shot repair simulation")
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("Threads must be positive.")
    import torch
    import cv2
    torch.set_num_threads(args.threads)
    video, markers = benchmark.read_project(args.project)
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    if fps <= 0:
        raise ValueError("Cannot read frame rate.")
    revision = subprocess.check_output(["git", "-C", str(args.repo), "rev-parse", "HEAD"], text=True).strip()
    started = time.perf_counter()
    output, frame_count = (omni_inference(args, video, torch) if args.model == "omni"
                           else tiny_inference(args, video, torch))
    elapsed = time.perf_counter() - started
    duration = frame_count / fps
    results = []
    if args.model == "omni":
        for name, cuts in omni_cut_variants(output, fps).items():
            results.append({"name": name, **score(cuts, markers, duration)})
    else:
        default = 0.296 if args.model == "autoshot" else 0.5
        for head, probabilities in output.items():
            for threshold in dict.fromkeys([default, 0.2, 0.3, 0.4, 0.5, 0.6]):
                results.append({"head": head, "threshold": threshold,
                                **score(probability_cuts(probabilities, threshold, fps), markers, duration)})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.model != "omni":
        import numpy as np
        np.savez_compressed(args.output.with_suffix(".npz"), **output)
    with args.checkpoint.open("rb") as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    report = {"model": args.model, "video": str(video), "markers": markers,
              "fps": fps, "frames": frame_count, "duration": duration,
              "device": "cpu", "threads": args.threads, "torch": torch.__version__,
              "seconds_including_load_decode_inference": round(elapsed, 3),
              "architecture_revision": revision, "checkpoint_sha256": digest.hexdigest(),
              "note": "One annotated video; temporal holdout is not independent validation. No deployment changes.",
              "results": results}
    if args.model == "omni":
        report["labeled_cuts"] = output
        report["adapter"] = "CPU tensors; no redundant ImageNet download; upstream window decoding, overlap 10."
    report["tuning_candidate"] = max(results, key=lambda x: x["tuning"]["f1"])
    if args.baseline:
        baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
        if Path(baseline["video"]).resolve() != video or baseline["markers"] != markers:
            raise ValueError("Baseline must refer to the same annotated video.")
        baseline_cuts = baseline["results"][0]["cuts"]
        variants = [{"candidate": result.get("name", f"{result.get('head')}:{result.get('threshold')}"),
                     **score(long_shot_repair(baseline_cuts, result["cuts"], duration), markers, duration)}
                    for result in results]
        report["cached_long_shot_repair"] = {"limit_seconds": 15,
            "note": "Simulated with full-video predictions; not actual cropped second-pass runtime.",
            "results": variants, "tuning_candidate": max(variants, key=lambda x: x["tuning"]["f1"])}
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"model": args.model, "seconds": elapsed, "default": results[0]["all"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
