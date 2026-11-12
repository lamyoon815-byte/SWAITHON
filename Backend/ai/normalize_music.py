"""배경 음악 20곡의 음량을 고르게 다듬어 Backend/music/normalized/*.m4a로 저장한다(macOS 전용, afconvert 사용).

왜: 곡마다 녹음 음량이 30dB 넘게 달라 같은 크기로 틀면 조용한 곡은 해설에 묻히고, 클래식은 한 곡 안에서도
갑자기 커지는 대목이 해설을 가린다. 재생 음량(0~1)만으로는 조용한 곡을 100% 넘게 키울 수 없다.

하는 일(곡마다)
1. 0.3초 구간 음량(RMS)을 재서, 곡의 중간 음량보다 6dB 넘게 큰 대목은 넘친 양의 2/3를 줄인다(압축 3:1).
2. 곡의 중간 음량을 TARGET_DBFS로 맞춘다(조용한 곡은 키우고 시끄러운 곡은 줄인다).
3. 그래도 0dBFS 가까이 튀는 순간은 부드럽게 눌러(soft clip) 찢어지지 않게 한다.
4. AAC(m4a)로 저장한다. 원본 MP3는 그대로 둔다.

실행(프로젝트 최상위): Backend/.venv/bin/python Backend/ai/normalize_music.py
"""
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np

MUSIC = Path(__file__).resolve().parents[1] / "music"
OUT = MUSIC / "normalized"
TARGET_DBFS = -24.0          # 다듬은 곡의 중간 음량. 앱은 해설보다 약 12dB 작게 들리도록 재생 음량을 정한다.
THRESHOLD_DB = 6.0           # 중간 음량보다 이만큼 큰 대목부터 줄인다
RATIO = 3.0
WINDOW_S = 0.3
SMOOTH_S = 0.2
CEILING = 0.95               # 약 -0.4dBFS
SILENCE_DB = -60.0
SAMPLE_RATE = 44100
BITRATE = 64000


def read(path: Path) -> np.ndarray:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "in.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}", "-c", "2", str(path), str(wav)], check=True)
        with wave.open(str(wav)) as w:
            data = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
            return data.reshape(-1, w.getnchannels())


def write(samples: np.ndarray, path: Path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "out.wav"
        pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(pcm.shape[1]); w.setsampwidth(2); w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm.tobytes())
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", str(BITRATE), str(wav), str(path)], check=True)


def moving_mean(values: np.ndarray, size: int) -> np.ndarray:
    size = max(1, size)
    cumulative = np.cumsum(np.concatenate([[0.0], values.astype(np.float64)]))
    out = (cumulative[size:] - cumulative[:-size]) / size
    pad = len(values) - len(out)
    return np.concatenate([np.full(pad // 2, out[0]), out, np.full(pad - pad // 2, out[-1])]).astype(np.float32)


def level_db(samples: np.ndarray) -> np.ndarray:
    power = moving_mean((samples ** 2).mean(1), int(WINDOW_S * SAMPLE_RATE))
    return 10 * np.log10(power + 1e-12)


def stats(samples: np.ndarray) -> tuple[float, float]:
    """(중간 음량, 큰 대목 음량=상위 5%) dBFS. 무음 구간은 뺀다."""
    levels = level_db(samples)[:: SAMPLE_RATE // 10]
    levels = levels[levels > SILENCE_DB]
    return float(np.median(levels)), float(np.percentile(levels, 95))


def process(samples: np.ndarray) -> np.ndarray:
    levels = level_db(samples)
    median, _ = stats(samples)
    over = np.maximum(0.0, levels - (median + THRESHOLD_DB))
    gain_db = moving_mean(-over * (1 - 1 / RATIO), int(SMOOTH_S * SAMPLE_RATE))
    compressed = samples * (10 ** (gain_db / 20))[:, None]
    compressed *= 10 ** ((TARGET_DBFS - stats(compressed)[0]) / 20)
    # 튀는 순간만 부드럽게 누른다(작은 소리는 그대로).
    return np.where(np.abs(compressed) > CEILING * 0.8,
                    np.sign(compressed) * (CEILING * 0.8 + CEILING * 0.2 * np.tanh((np.abs(compressed) - CEILING * 0.8) / (CEILING * 0.2))),
                    compressed)


def main():
    OUT.mkdir(exist_ok=True)
    print(f"{'곡':26s} {'원곡 중간':>8s} {'원곡 큰대목':>10s} → {'다듬은 중간':>10s} {'큰대목':>7s}")
    for path in sorted(MUSIC.glob("*.mp3")):
        original = read(path)
        result = process(original)
        target = OUT / (path.stem + ".m4a")
        write(result, target)
        before, after = stats(original), stats(read(target))
        print(f"{path.name:26s} {before[0]:8.1f} {before[1]-before[0]:+9.1f}dB → {after[0]:10.1f} {after[1]-after[0]:+6.1f}dB  {target.stat().st_size/1e6:4.1f}MB")


if __name__ == "__main__":
    main()
