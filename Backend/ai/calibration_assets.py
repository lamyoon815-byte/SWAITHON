"""보기 설정 테스트(FE 6 캘리브레이션 · 8-1 세부 조정)에 쓸 단계별 그림을 미리 만든다.

왜 미리 만드나
- 색각 보정과 선 굵기 보정은 서버 계산(사진 1장 약 0.5초)이고, /correction은 사용자당 분당 5회 제한이 있다.
- 테스트와 슬라이더는 그림이 바로 바뀌어야 하므로, 단계별 결과를 앱에 넣어 두고 실제 작품에만 /correction을 쓴다.
- 대비·밝기는 앱 Skia가 실시간으로 처리하므로 원본만 넣는다.

결과 (Frontend/assets/images/calibration/)
- plate-*.jpg      : 점으로 숫자를 그린 색 구분 그림(ai/plates.py로 새로 만든 것)과 단계별 보정본
- <작품>-*.jpg     : 실제 그림 미리보기용 단계별 보정본, 선 굵기·대비 테스트 그림
- calibration.json : 단계·질문·정답·파일·작품 출처
- index.ts         : 앱에서 바로 쓰는 require() 목록 (calibration.json과 같은 내용)

실행 (MoMi 폴더에서):
    .\\Backend\\.venv\\Scripts\\python.exe Backend\\ai\\calibration_assets.py
"""
from io import BytesIO
import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
sys.path[:] = [entry for entry in sys.path if Path(entry or ".").resolve() != Path(__file__).resolve().parent]
sys.path.insert(0, str(BACKEND))

from ai.correction import correct_image  # noqa: E402
from ai.plates import make_plate  # noqa: E402

OUT = BACKEND.parent / "Frontend" / "assets" / "images" / "calibration"
LONG_SIDE = 900
QUALITY = 80
LEVELS = [0, 20, 40, 60, 80, 100]  # % (보정 세기 0.0~1.0을 20%씩)
CONTRAST_LEVELS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]
COLOR_TYPES = ("protan", "deutan", "tritan")

# 검사판 숫자. 첫 번째는 보정 없는 판(1단계), 나머지는 20%~100% 보정판(2단계)에 쓴다.
# 단계마다 숫자를 바꿔, 앞에서 본 숫자를 기억해서 맞히지 않게 한다.
PLATE_NUMBERS = {"protan": [45, 86, 32, 57, 94, 28],
                 "deutan": [29, 74, 63, 85, 42, 96],
                 "tritan": [73, 38, 52, 69, 24, 87]}
PLATE_SEED = {"protan": 101, "deutan": 202, "tritan": 303}

# 실제 그림: 등록 작품 중 해당 색각 유형에서 구분이 사라지는 색이 많은 작품을 수치로 골랐다.
# crop: (왼쪽, 위, 오른쪽, 아래) 비율. 휴대폰 화면에서 비교할 부분이 크게 보이도록 자른다.
SAMPLES = {
    "farmhouse": {"artwork_id": "nga-01", "crop": (0.0, 0.3, 0.6, 1.0)},   # 초록 잎 사이 빨간 꽃 (적색약·녹색약)
    "bedroom": {"artwork_id": "aic-02", "crop": None},                     # 노란 의자와 주황 침대 (청색약)
    "shower": {"artwork_id": "aic-07", "crop": None},                      # 가는 빗줄기 (선 굵기)
    "symphony": {"artwork_id": "nga-05", "crop": None},                    # 흰색끼리 낮은 대비 (대비)
}
QUESTIONS = {
    "screening": "그림 속 숫자가 보이면 골라 주세요.",
    "color": "그림 속 숫자가 보이면 골라 주세요.",
    "edge": "빗줄기와 다리 위 사람들이 또렷하게 보이나요?",
    "contrast": "흰 옷과 뒤의 흰 커튼이 구분되나요?",
}
PREVIEW_SAMPLE = {"protan": "farmhouse", "deutan": "farmhouse", "tritan": "bedroom"}
NOT_VISIBLE = "숫자가 안 보여요"


def to_jpeg(array):
    stream = BytesIO()
    Image.fromarray((np.clip(array, 0, 1) * 255).round().astype(np.uint8)).save(stream, format="JPEG", quality=95)
    return stream.getvalue()


def source_jpeg(record, crop):
    with Image.open(BACKEND / record["image_path"]) as image:
        image = image.convert("RGB")
        if crop:
            w, h = image.size
            image = image.crop((round(crop[0] * w), round(crop[1] * h), round(crop[2] * w), round(crop[3] * h)))
        image.thumbnail((LONG_SIDE, LONG_SIDE), Image.Resampling.LANCZOS)
        stream = BytesIO()
        image.save(stream, format="JPEG", quality=95)
        return stream.getvalue()


def save(content, name):
    # 서버 /correction과 같은 함수(correct_image)의 결과를 앱 용량에 맞게 다시 저장한다.
    with Image.open(BytesIO(content)) as image:
        image.convert("RGB").save(OUT / name, format="JPEG", quality=QUALITY, optimize=True)
    return name


def choices(answer, rng):
    """큰 버튼 4개: 정답 + 다른 숫자 2개 + '숫자가 안 보여요'. 순서는 섞는다."""
    pool = [n for n in range(23, 99) if n % 10 and n // 10 != n % 10 and n != answer
            and not set(str(n)) & set(str(answer))]
    numbers = [str(answer)] + [str(n) for n in rng.choice(pool, size=2, replace=False)]
    rng.shuffle(numbers)
    return numbers + [NOT_VISIBLE]


def main(edges_only=False, colors_only=False):
    records = {record["id"]: record for record in json.loads((BACKEND / "catalog.artworks.json").read_text(encoding="utf-8"))}
    OUT.mkdir(parents=True, exist_ok=True)
    if colors_only:
        # 기존 질문·정답은 보존하고 현재 서버 알고리즘으로 색 보정 자료만 갱신한다.
        manifest = json.loads((OUT / "calibration.json").read_text(encoding="utf-8"))
        for color_type in COLOR_TYPES:
            for index, number in enumerate(PLATE_NUMBERS[color_type]):
                source = to_jpeg(make_plate(color_type, number, PLATE_SEED[color_type] + index)[0])
                level = LEVELS[index]
                content = correct_image(source, {"color_type": color_type, "severity": level / 100}) if level else source
                save(content, f"plate-{color_type}-{number}-{level}.jpg")
            plate = to_jpeg(make_plate(color_type, PLATE_NUMBERS[color_type][0], PLATE_SEED[color_type])[0])
            sample = SAMPLES[PREVIEW_SAMPLE[color_type]]
            artwork = source_jpeg(records[sample["artwork_id"]], sample["crop"])
            for kind, source in (("plate", plate), ("artwork", artwork)):
                for index, level in enumerate(LEVELS):
                    content = correct_image(source, {"color_type": color_type, "severity": level / 100}) if level else source
                    save(content, manifest["preview"][color_type][kind][index])
        print("Updated color calibration and slider previews using the current correction algorithm.")
        return
    if edges_only:
        # 보정 알고리즘 변경 시 기존 숫자 검사판·메타데이터는 보존하고 윤곽선 미리보기만 갱신한다.
        sample = SAMPLES["shower"]
        source = source_jpeg(records[sample["artwork_id"]], sample["crop"])
        for level in LEVELS[1:]:
            save(correct_image(source, {"edge": level / 100}), f"shower-edge-{level}.jpg")
        print("Updated 5 edge previews using the artwork correction algorithm.")
        return
    for old in OUT.glob("*.jpg"):
        old.unlink()
    rng = np.random.default_rng(20261111)

    # 1·2단계: 색 구분 검사판
    screening, color, slider_plates = [], {}, {}
    for color_type in COLOR_TYPES:
        plates = []
        for index, number in enumerate(PLATE_NUMBERS[color_type]):
            array, _ = make_plate(color_type, number, PLATE_SEED[color_type] + index)
            level = LEVELS[index]
            content = to_jpeg(array)
            if level:
                content = correct_image(content, {"color_type": color_type, "severity": level / 100})
            plates.append({"level": level / 100, "answer": str(number), "choices": choices(number, rng),
                           "file": save(content, f"plate-{color_type}-{number}-{level}.jpg")})
        screening.append({"color_type": color_type, **{k: plates[0][k] for k in ("answer", "choices", "file")}})
        color[color_type] = {"question": QUESTIONS["color"], "levels": [p["level"] for p in plates[1:]],
                             "plates": [{k: p[k] for k in ("answer", "choices", "file")} for p in plates[1:]]}
        # 8-1 슬라이더용: 숫자 하나(1단계 판)를 0~100%로 보정한 그림
        first = to_jpeg(make_plate(color_type, PLATE_NUMBERS[color_type][0], PLATE_SEED[color_type])[0])
        slider_plates[color_type] = [plates[0]["file"]] + [
            save(correct_image(first, {"color_type": color_type, "severity": level / 100}),
                 f"plate-{color_type}-{PLATE_NUMBERS[color_type][0]}-slider-{level}.jpg") for level in LEVELS[1:]]

    # 실제 그림 미리보기, 선 굵기, 대비
    sources = {key: source_jpeg(records[sample["artwork_id"]], sample["crop"]) for key, sample in SAMPLES.items()}
    originals = {key: save(content, f"{key}-original.jpg") for key, content in sources.items()}

    def corrected(sample, name, profile):
        return save(correct_image(sources[sample], profile), name)

    preview = {color_type: {"plate": slider_plates[color_type], "artwork": [originals[sample]] + [
        corrected(sample, f"{sample}-{color_type}-{level}.jpg", {"color_type": color_type, "severity": level / 100})
        for level in LEVELS[1:]]} for color_type, sample in PREVIEW_SAMPLE.items()}
    edge = {"question": QUESTIONS["edge"], "levels": [level / 100 for level in LEVELS],
            "files": [originals["shower"]] + [corrected("shower", f"shower-edge-{level}.jpg", {"edge": level / 100})
                                              for level in LEVELS[1:]]}
    contrast = {"question": QUESTIONS["contrast"], "levels": CONTRAST_LEVELS, "file": originals["symphony"],
                "note": "앱 Skia에서 contrast 값만 바꿔 보여 준다."}

    credits = [{"file": originals[key], "artwork_id": sample["artwork_id"],
                **{field: records[sample["artwork_id"]][field] for field in ("title", "artist", "source_url", "license")}}
               for key, sample in SAMPLES.items()]
    manifest = {"generated_by": "Backend/ai/calibration_assets.py",
                "screening": {"question": QUESTIONS["screening"], "not_visible": NOT_VISIBLE, "plates": screening},
                "color": color, "preview": {"levels": [level / 100 for level in LEVELS], **preview},
                "edge": edge, "contrast": contrast, "credits": credits}
    (OUT / "calibration.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "index.ts").write_text(typescript(manifest), encoding="utf-8")

    files = sorted(OUT.glob("*.jpg"))
    total = sum(path.stat().st_size for path in files)
    print(f"그림 {len(files)}장, 합계 {total / 1e6:.1f}MB → {OUT}")


def typescript(manifest):
    """React Native는 require() 경로가 고정돼야 하므로 목록을 코드로 만들어 둔다."""
    req = lambda name: f"require('./{name}')"
    text = lambda value: json.dumps(value, ensure_ascii=False)
    plate = lambda p: f"{{ answer: {text(p['answer'])}, choices: {text(p['choices'])}, image: {req(p['file'])} }}"
    screening = "\n".join(f"      {{ color_type: '{p['color_type']}', {plate(p)[2:]}," for p in manifest["screening"]["plates"])
    color = "\n".join(
        f"    {t}: {{ levels: {text(item['levels'])}, plates: [\n" + "\n".join(f"      {plate(p)}," for p in item["plates"]) + "\n    ] },"
        for t, item in manifest["color"].items())
    preview = "\n".join(
        f"    {t}: {{ plate: [{', '.join(req(n) for n in item['plate'])}],\n"
        f"      artwork: [{', '.join(req(n) for n in item['artwork'])}] }},"
        for t, item in manifest["preview"].items() if t != "levels")
    edge, contrast = manifest["edge"], manifest["contrast"]
    return f"""// 자동 생성 파일: Backend/ai/calibration_assets.py 가 만든다. 직접 고치지 말고 스크립트를 다시 실행하세요.
// 규칙 설명: docs/ai-calibration.md

export type CalibrationColorType = 'normal' | 'protan' | 'deutan' | 'tritan';
export type CalibrationPlate = {{ answer: string; choices: string[]; image: number }};

export const CALIBRATION_NOT_VISIBLE = {text(manifest['screening']['not_visible'])};

export const CALIBRATION = {{
  /** 1단계: 보정 없는 검사판 3장. 어느 판의 숫자를 못 맞혔는지로 color_type을 정한다 */
  screening: {{
    question: {text(manifest['screening']['question'])},
    plates: [
{screening}
    ] as ({{ color_type: Exclude<CalibrationColorType, 'normal'> }} & CalibrationPlate)[],
  }},
  /** 2단계: 색 보정 세기. plates[i]는 levels[i](= AIProfile.severity)로 보정한 검사판. 숫자를 맞히면 멈춘다 */
  color: {{
    question: {text(QUESTIONS['color'])},
{color}
  }} as {{ question: string }} & Record<Exclude<CalibrationColorType, 'normal'>, {{ levels: number[]; plates: CalibrationPlate[] }}>,
  /** 8-1 슬라이더 미리보기. plate[i]·artwork[i]가 levels[i]로 보정한 그림 (0번은 원본) */
  preview: {{
    levels: {text(manifest['preview']['levels'])},
{preview}
  }},
  /** 3단계: 선 굵기. images[i]가 levels[i](= AIProfile.edge)로 보정한 그림 */
  edge: {{ question: {text(edge['question'])}, levels: {text(edge['levels'])}, images: [{", ".join(req(name) for name in edge['files'])}] }},
  /** 4단계: 대비. 그림은 원본 하나이고 Skia contrast 값만 levels 순서로 바꾼다 */
  contrast: {{ question: {text(contrast['question'])}, levels: {text(contrast['levels'])}, image: {req(contrast['file'])} }},
}};
"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edges-only", action="store_true", help="기존 자료를 유지하고 윤곽선 미리보기 5장만 갱신")
    parser.add_argument("--colors-only", action="store_true", help="기존 질문·정답을 유지하고 색 보정 미리보기만 갱신")
    args = parser.parse_args()
    main(edges_only=args.edges_only, colors_only=args.colors_only)
