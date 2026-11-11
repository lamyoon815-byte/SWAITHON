"""낭독 순서, 단독 감상 모드, 1분·3분 대본 점검 회귀 테스트. 외부 API를 호출하지 않는다."""
import json
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from Backend.ai_routes import make_narration, narration_key, narration_segments
from Backend.catalog import Description
from Backend.generated_cache import GeneratedCache
from Backend.gemini import GeminiSchemaError, GeminiService, LongCommentary, NarratedDescription, spoken_chars
from Backend.tests import test_ai_routes as fixtures


FLOW = {
    "facts": ["왼쪽 창문 아래로 옅은 빛이 들어옵니다.", "빛은 바닥까지 길게 뻗어 있습니다.",
              "오른쪽에는 빈 의자가 놓여 있습니다.", "뒤쪽 문 너머로 작은 정원이 보입니다."],
    "interpretations": ["바닥을 채운 옅은 빛이 차분한 분위기를 만듭니다.", "홀로 놓인 빈 의자는 쓸쓸함을 더합니다."],
    "regions": [{"label": "창가", "bbox": [0, 0, 0.4, 1], "color": "밝은 회색"},
                {"label": "빈 의자", "bbox": [0.5, 0.5, 0.2, 0.4], "color": "짙은 갈색"}],
    "mood_keywords": ["차분함", "쓸쓸함"],
    "fact_region_indices": [0, 0, 1, None], "interpretation_region_indices": [0, 1],
    "narration_order": [{"type": "fact", "index": 0}, {"type": "fact", "index": 1},
                        {"type": "interpretation", "index": 0}, {"type": "fact", "index": 2},
                        {"type": "interpretation", "index": 1}, {"type": "fact", "index": 3}],
}
FLOW_TEXTS = [FLOW["facts"][0], FLOW["facts"][1], FLOW["interpretations"][0],
              FLOW["facts"][2], FLOW["interpretations"][1], FLOW["facts"][3]]


class NarrationOrderTests(unittest.TestCase):
    def test_written_order_and_region_links_survive_mode_filtering(self):
        description = Description.model_validate(FLOW).model_dump()
        segments = narration_segments(description)
        self.assertEqual([s["text"] for s in segments], FLOW_TEXTS)
        self.assertEqual([s["region_index"] for s in segments], [0, 0, 0, 1, 1, None])
        self.assertEqual([s["text"] for s in narration_segments(description, "facts")], FLOW["facts"])
        self.assertEqual([s["text"] for s in narration_segments(description, "interpretations")], FLOW["interpretations"])

    def test_order_rejects_duplicate_missing_and_invalid_references(self):
        for order in (FLOW["narration_order"][:-1], FLOW["narration_order"] + [FLOW["narration_order"][0]],
                      [{"type": "fact", "index": 99}] + FLOW["narration_order"][1:],
                      [FLOW["narration_order"][0]] * len(FLOW["narration_order"])):
            with self.subTest(order=order), self.assertRaises(ValidationError):
                Description.model_validate({**FLOW, "narration_order": order})
        with self.assertRaises(ValidationError):
            NarratedDescription.model_validate({key: value for key, value in FLOW.items() if key != "narration_order"})

    def test_legacy_descriptions_pair_regions_and_keep_repeated_sentences(self):
        legacy = {**FLOW, "narration_order": None}
        segments = narration_segments(legacy)
        self.assertEqual([s["region_index"] for s in segments], [0, 0, 0, 1, 1, None])
        self.assertEqual(len(segments), len(FLOW_TEXTS))
        repeated = {"facts": ["관찰"], "interpretations": ["감상", "감상"]}
        self.assertEqual([s["text"] for s in narration_segments(repeated)], ["관찰", "감상", "감상"])


class NarrationFlowRouteTests(unittest.TestCase):
    setUp = fixtures.AIRouteTests.setUp
    seed = fixtures.AIRouteTests.seed

    def test_pregenerated_narration_and_api_share_the_same_cache(self):
        catalog = self.app.state.catalog
        record = catalog.get("sample")
        content = (catalog.images_dir / record["image_filename"]).read_bytes()
        gemini = fixtures.FixtureGemini()
        with patch.object(fixtures.FixtureGemini, "describe", return_value=Description.model_validate(FLOW)):
            result = make_narration(gemini, "sample", record, content, "brief")
        key = narration_key("brief", getattr(gemini, "model", ""), record, content)
        GeneratedCache(catalog.data_dir).put("narration", key, json.dumps(result, ensure_ascii=False).encode())
        with patch.object(fixtures.FixtureGemini, "describe", side_effect=AssertionError("must reuse pregenerated script")):
            response = self.client.post("/artworks/sample/narration")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "\n".join(FLOW_TEXTS))

    def test_brief_generation_and_cache_keep_composed_order(self):
        with patch.object(fixtures.FixtureGemini, "describe", return_value=Description.model_validate(FLOW)) as describe:
            first = self.client.post("/artworks/sample/narration").json()
            cached = self.client.post("/artworks/sample/narration").json()
        self.assertEqual(describe.call_count, 1)
        self.assertEqual(first, cached)
        self.assertEqual(first["length"], "brief")
        self.assertEqual([s["text"] for s in first["segments"]], FLOW_TEXTS)
        self.assertEqual(first["text"], "\n".join(FLOW_TEXTS))

    def test_reviewed_description_keeps_narrative_order_in_all_modes(self):
        records = json.loads(self.manifest.read_text())
        records[0]["description"] = FLOW
        self.manifest.write_text(json.dumps(records))
        self.app.state.catalog.import_manifest(self.manifest)
        for mode, texts in (("both", FLOW_TEXTS), ("facts", FLOW["facts"]), ("interpretations", FLOW["interpretations"])):
            with self.subTest(mode=mode):
                response = self.client.get(f"/artworks/sample/narration?mode={mode}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["text"], "\n".join(texts))

    def test_unregistered_analysis_returns_the_same_composed_order(self):
        with patch.object(fixtures.FixtureGemini, "describe", return_value=Description.model_validate(FLOW)):
            response = self.client.post("/analyze", files={"image": ("work.png", self.image, "image/png")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([s["text"] for s in response.json()["segments"]], FLOW_TEXTS)


def brief_draft(count):
    return NarratedDescription(facts=["가" * (count - 40), "나" * 20], interpretations=["다" * 20],
                              regions=[], mood_keywords=[], narration_order=[
                                  {"type": "fact", "index": 0}, {"type": "interpretation", "index": 0},
                                  {"type": "fact", "index": 1}])


def detailed_draft(count, missing_context=False):
    keys = [("intro", "fact"), ("artist", "fact"), ("artist", "interpretation"),
            ("context", "fact"), ("story", "fact"), ("description", "fact"),
            ("description", "interpretation"), ("reception", "interpretation"), ("closing", "interpretation")]
    if missing_context:
        keys = [item for item in keys if item[0] != "context"]
    sizes = [count // len(keys)] * len(keys)
    sizes[-1] += count % len(keys)
    return LongCommentary(sections=[{"key": key, "heading": key, "type": kind, "text": "가" * size, "sources": [1]}
                                    for (key, kind), size in zip(keys, sizes)])


class NarrationLengthTests(unittest.TestCase):
    def test_brief_rewrites_to_one_minute_and_keeps_composed_order(self):
        service = GeminiService()
        rewritten = brief_draft(325)
        with patch.object(service, "generate", side_effect=[brief_draft(150), rewritten]) as generate:
            result = service.describe(b"image", {"title": "작품"}, brief=True)
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(result, rewritten)
        self.assertEqual(spoken_chars(" ".join(result.facts + result.interpretations)), 325)
        self.assertEqual([s["type"] for s in narration_segments(result.model_dump())], ["fact", "interpretation", "fact"])

    def test_brief_keeps_valid_draft_if_rewrite_has_invalid_schema(self):
        service = GeminiService()
        draft = brief_draft(280)
        with patch.object(service, "generate", side_effect=[draft, GeminiSchemaError()]):
            self.assertEqual(service.describe(b"image", brief=True), draft)

    def test_detailed_rewrite_prioritizes_complete_topics_and_preserves_flow(self):
        service = GeminiService()
        complete = detailed_draft(1100)
        grounding = {"groundingChunks": [{"web": {"uri": "https://museum.example/art", "title": "미술관"}}]}
        with patch.object(service, "generate", side_effect=[("조사 노트", grounding),
                                                           detailed_draft(1020, missing_context=True), complete]) as generate:
            result = service.long_commentary(b"image", {"title": "작품"})
        self.assertEqual(generate.call_count, 3)
        self.assertEqual(result["sections"], [section.model_dump() for section in complete.sections])
        self.assertEqual(result["char_count"], 1100)
        self.assertEqual([s["type"] for s in result["sections"]][1:4], ["fact", "interpretation", "fact"])
        self.assertEqual(result["sources"][0]["url"], "https://museum.example/art")
