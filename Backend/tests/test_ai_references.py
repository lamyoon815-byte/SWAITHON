"""작품마다 기준 사진 여러 장(Backend/ai/references.py): CLIP 없이 확인한다."""
from io import BytesIO
import unittest

import numpy as np
from PIL import Image

from Backend.ai.references import center_crop, max_per_owner, reference_contents, reference_images


def sample_image():
    pixels = np.random.default_rng(0).integers(0, 256, size=(120, 160, 3), dtype=np.uint8)
    return Image.fromarray(pixels)


class ReferenceTests(unittest.TestCase):
    def test_zero_variants_returns_only_original(self):
        image = sample_image()
        images = reference_images(image, 0, index=3)
        self.assertEqual(len(images), 1)
        self.assertEqual(np.asarray(images[0]).tobytes(), np.asarray(image).tobytes())
        content = b"original-bytes"
        self.assertEqual(reference_contents(content, 0, index=3), [content])  # 지금과 같은 원본 바이트 그대로

    def test_same_index_gives_identical_images(self):
        image = sample_image()
        first, second = reference_images(image, 4, index=5), reference_images(image, 4, index=5)
        self.assertEqual(len(first), 1 + 2 + 4)  # 원본 + 가운데 자르기 2장 + 휴대폰 촬영 흉내 4장
        for a, b in zip(first, second):
            self.assertEqual(a.size, b.size)
            self.assertEqual(np.asarray(a).tobytes(), np.asarray(b).tobytes())
        other = reference_images(image, 4, index=6)
        self.assertNotEqual(np.asarray(first[3]).tobytes(), np.asarray(other[3]).tobytes())  # 작품마다 다른 변형

    def test_contents_keep_original_bytes_first(self):
        output = BytesIO()
        sample_image().save(output, format="PNG")
        content = output.getvalue()
        contents = reference_contents(content, 2, index=0)
        self.assertEqual(len(contents), 1 + 2 + 2)
        self.assertEqual(contents[0], content)
        self.assertEqual(contents, reference_contents(content, 2, index=0))

    def test_center_crop_keeps_center(self):
        crop = center_crop(sample_image(), 0.8)
        self.assertEqual(crop.size, (128, 96))

    def test_max_per_owner_picks_right_artwork(self):
        # 사진 2장 × 기준 사진 5장(작품 0: 2장, 작품 1: 2장, 작품 2: 1장)
        scores = np.array([[0.2, 0.9, 0.5, 0.4, 0.1],
                           [0.3, 0.2, 0.1, 0.4, 0.8]])
        owners = np.array([0, 0, 1, 1, 2])
        reduced = max_per_owner(scores, owners, 3)
        np.testing.assert_allclose(reduced, [[0.9, 0.5, 0.1], [0.3, 0.4, 0.8]])
        self.assertEqual(np.argmax(reduced, axis=1).tolist(), [0, 2])
        np.testing.assert_allclose(max_per_owner(scores[0], owners, 3), [0.9, 0.5, 0.1])  # 사진 1장(서버 경로)


if __name__ == "__main__":
    unittest.main()
