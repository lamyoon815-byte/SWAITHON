"""보기 설정 테스트 그림(Frontend/assets/images/calibration) 목록이 실제 파일과 맞는지 확인한다."""
import json
from pathlib import Path
import re
import unittest

FOLDER = Path(__file__).resolve().parents[2] / "Frontend" / "assets" / "images" / "calibration"


@unittest.skipUnless((FOLDER / "calibration.json").exists(), "테스트 그림을 아직 만들지 않음")
class CalibrationAssetTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((FOLDER / "calibration.json").read_text(encoding="utf-8"))

    def referenced(self):
        m = self.manifest
        names = [plate["file"] for plate in m["screening"]["plates"]] + [m["contrast"]["file"]] + m["edge"]["files"]
        for item in m["color"].values():
            names += [plate["file"] for plate in item["plates"]]
        for key, item in m["preview"].items():
            if key != "levels":
                names += item["plate"] + item["artwork"]
        return set(names)

    def test_files_exist_and_levels_match(self):
        for name in self.referenced():
            self.assertTrue((FOLDER / name).is_file(), name)
        self.assertEqual(self.manifest["edge"]["levels"], [0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
        self.assertEqual(self.manifest["preview"]["levels"], [0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
        self.assertEqual({p["color_type"] for p in self.manifest["screening"]["plates"]}, {"protan", "deutan", "tritan"})
        for color_type, item in self.manifest["color"].items():
            self.assertEqual(item["levels"], [0.2, 0.4, 0.6, 0.8, 1.0])
            self.assertEqual(len(item["plates"]), 5)
            self.assertEqual(len(self.manifest["preview"][color_type]["plate"]), 6)
            self.assertEqual(len(self.manifest["preview"][color_type]["artwork"]), 6)

    def test_plate_answers_are_unique_and_offered(self):
        plates = self.manifest["screening"]["plates"] + [p for item in self.manifest["color"].values() for p in item["plates"]]
        for plate in plates:
            self.assertEqual(plate["choices"].count(plate["answer"]), 1)
            self.assertEqual(plate["choices"][-1], self.manifest["screening"]["not_visible"])
            self.assertEqual(len(set(plate["choices"])), 4)
        # 단계마다 숫자가 달라야 앞에서 본 숫자를 기억해서 맞히지 못한다.
        for color_type in self.manifest["color"]:
            answers = [p["answer"] for p in self.manifest["screening"]["plates"] if p["color_type"] == color_type]
            answers += [p["answer"] for p in self.manifest["color"][color_type]["plates"]]
            self.assertEqual(len(answers), len(set(answers)))

    def test_typescript_list_matches_manifest(self):
        required = set(re.findall(r"require\('\./([^']+)'\)", (FOLDER / "index.ts").read_text(encoding="utf-8")))
        self.assertEqual(required, self.referenced())


class PlateTests(unittest.TestCase):
    def test_number_hidden_in_simulation_and_restored_by_correction(self):
        from Backend.ai.correction import correct_array, simulate
        from Backend.ai.plates import make_plate, number_contrast
        for color_type in ("protan", "deutan"):
            plate, dots = make_plate(color_type, 45, seed=1, size=360)
            normal = number_contrast(plate, dots)
            hidden = number_contrast(simulate(plate, color_type, 1.0), dots)
            restored = number_contrast(simulate(correct_array(plate, {"color_type": color_type, "severity": 1.0}),
                                                color_type, 1.0), dots)
            self.assertGreater(normal, 30, color_type)    # 정상 시각에는 숫자가 뚜렷하다.
            self.assertLess(hidden, 3, color_type)        # 시뮬레이션에서는 숫자가 사라진다.
            self.assertGreater(restored, 20, color_type)  # 보정하면 다시 보인다.


if __name__ == "__main__":
    unittest.main()
