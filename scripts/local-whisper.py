#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
本地语音识别脚本 - 使用 faster-whisper
"""
import sys
import json
import argparse
import io
from faster_whisper import WhisperModel

# 设置输出编码为 UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


def transcribe(audio_path: str, model_size: str = "small"):
    """使用 faster-whisper 转录音频"""
    print(f"Loading model: {model_size}", file=sys.stderr)

    # 使用 tiny 模型（最快）
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"Transcribing: {audio_path}", file=sys.stderr)
    segments, info = model.transcribe(audio_path, language="zh", beam_size=5)

    print(f"Language: {info.language}, Duration: {info.duration}", file=sys.stderr)

    result = {
        "language": info.language or "zh",
        "duration": info.duration or 0,
        "segments": []
    }

    for segment in segments:
        result["segments"].append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip()
        })

    # 输出 JSON 格式
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="本地语音识别")
    parser.add_argument("audio", help="音频文件路径")
    parser.add_argument("--model", default="tiny", help="模型大小: tiny, base, small, medium, large")

    args = parser.parse_args()

    try:
        transcribe(args.audio, args.model)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
