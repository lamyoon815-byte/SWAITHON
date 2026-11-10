"""evaluation.py의 기준값 선택·교차 검증 함수 테스트 (실제 모델 없이 가짜 점수로 확인)."""
import unittest

import numpy as np

from Backend.ai.evaluation import (choose_gate_threshold, choose_high_threshold, choose_match_threshold,
                                   group_folds, threshold_outcomes)


class ThresholdTests(unittest.TestCase):
    def setUp(self):
        self.ids = np.array(["a", "b", "c", "a", "x", "y"])
        self.scores = np.array([0.9, 0.85, 0.7, 0.6, 0.65, 0.55])
        self.kinds = np.array(["registered"] * 4 + ["unregistered"] * 2)
        self.labels = np.array(["a", "b", "c", "b", "", ""])  # 4번째는 1순위가 오답

    def test_outcomes_count_each_error_type(self):
        counts = threshold_outcomes(self.ids, self.scores, self.kinds, self.labels, 0.62)
        self.assertEqual(counts, {"registered": 4, "unregistered": 2, "correct_accept": 3, "wrong_accept": 0,
                                  "false_reject": 1, "false_match": 1})

    def test_match_threshold_separates_and_prefers_strict(self):
        t = choose_match_threshold(self.ids, self.scores, self.kinds, self.labels)
        self.assertTrue(0.65 < t <= 0.7)  # 미등록 최고점(0.65)보다 높고 정답(0.7)은 통과

    def test_high_threshold_above_all_errors(self):
        self.assertAlmostEqual(choose_high_threshold(self.ids, self.scores, self.kinds, self.labels, 0.66), 0.66)
        self.assertIsNone(choose_high_threshold(self.ids, np.array([0.9, 0.9, 0.9, 0.995, 0.5, 0.5]),
                                                self.kinds, self.labels, 0.6))

    def test_gate_threshold_and_folds(self):
        probabilities = np.array([0.9, 0.8, 0.3, 0.1])
        kinds = np.array(["registered", "unregistered", "not_artwork", "not_artwork"])
        t = choose_gate_threshold(probabilities, kinds)
        self.assertTrue(0.3 < t <= 0.8)
        folds = group_folds(["g1", "g1", "g2", "g3", "g4", "g5", "g6"], seed=0)
        self.assertEqual(folds[0], folds[1])  # 같은 작품 사진은 같은 겹에만 들어간다.
        self.assertEqual(len(set(folds.tolist())), 5)


if __name__ == "__main__":
    unittest.main()
