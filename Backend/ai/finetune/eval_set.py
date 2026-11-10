"""평가 전용 작품 목록. 여기 있는 작품은 파인튜닝 학습 데이터에서 반드시 제외한다.

- UNREGISTERED: 카탈로그에 없는 '미등록 작품' 10점(NGA 공개 이미지). 모니터에 띄워 촬영한 사진으로
  '등록되지 않은 작품을 잘못 매칭하지 않는지'를 평가한다. 앞의 5점은 등록 작품과 화가·화풍이 비슷한 어려운 예시다.
- REGISTERED_NGA_OBJECT_IDS: 카탈로그에 등록한 NGA 7점(+같은 판화의 다른 인쇄본).
- REGISTERED_TITLE_KEYWORDS: Met·AIC 등록 작품과 같은 작품(다른 소장본)을 학습에서 빼기 위한 제목 키워드.
"""

UNREGISTERED = [
    # 등록 작품과 비슷한 어려운 예시
    {"file": "nga_the-japanese-footbridge", "object_id": "74796", "number": "1992.9.1",
     "title": "The Japanese Footbridge", "artist": "Claude Monet",
     "iiif": "https://api.nga.gov/iiif/0b9cefb5-1ee4-401a-8154-8d4039191a28"},
    {"file": "nga_the-lighthouse-at-honfleur", "object_id": "61383", "number": "1983.1.33",
     "title": "The Lighthouse at Honfleur", "artist": "Georges Seurat",
     "iiif": "https://api.nga.gov/iiif/68979753-2414-4f87-9111-8f7566d54077"},
    {"file": "nga_self-portrait-van-gogh", "object_id": "106382", "number": "1998.74.5",
     "title": "Self-Portrait", "artist": "Vincent van Gogh",
     "iiif": "https://api.nga.gov/iiif/54ee6643-e0f9-4b92-a1d2-441e5108724d"},
    {"file": "nga_girl-with-a-hoop", "object_id": "46533", "number": "1963.10.58",
     "title": "Girl with a Hoop", "artist": "Auguste Renoir",
     "iiif": "https://api.nga.gov/iiif/350ae4bb-a288-4d65-be2a-0680e75ff6d6"},
    {"file": "nga_nocturne-whistler", "object_id": "3162", "number": "1942.15.2",
     "title": "Nocturne", "artist": "James McNeill Whistler",
     "iiif": "https://api.nga.gov/iiif/6ca631b8-e07c-48b1-9dcb-7018df807be6"},
    # 등록 작품과 다른 예시
    {"file": "nga_breezing-up", "object_id": "30228", "number": "1943.13.1",
     "title": "Breezing Up (A Fair Wind)", "artist": "Winslow Homer",
     "iiif": "https://api.nga.gov/iiif/406b5d56-d196-4bb0-b2e0-5a2f6fd52d0a"},
    {"file": "nga_watson-and-the-shark", "object_id": "46471", "number": "1963.6.1",
     "title": "Watson and the Shark", "artist": "John Singleton Copley",
     "iiif": "https://api.nga.gov/iiif/b38ce693-ba56-4953-9c2c-d8139fe4b059"},
    {"file": "nga_the-boating-party", "object_id": "46569", "number": "1963.10.94",
     "title": "The Boating Party", "artist": "Mary Cassatt",
     "iiif": "https://api.nga.gov/iiif/f8b6727d-6998-4f2a-9708-8694b9c69f54"},
    {"file": "nga_the-dance-class", "object_id": "165300", "number": "2014.79.710",
     "title": "The Dance Class", "artist": "Edgar Degas",
     "iiif": "https://api.nga.gov/iiif/5aabd016-748d-4f81-855d-7963dc5a62b4"},
    {"file": "nga_the-artists-garden-at-vetheuil", "object_id": "52189", "number": "1970.17.45",
     "title": "The Artist's Garden at Vétheuil", "artist": "Claude Monet",
     "iiif": "https://api.nga.gov/iiif/9fc88734-2f9a-4da8-8d46-2b570b201223"},
]

REGISTERED_NGA_OBJECT_IDS = {
    "52178",  # Farmhouse in Provence
    "72328",  # Roses
    "46681",  # A Girl with a Watering Can
    "61379",  # Woman with a Parasol
    "12198",  # Symphony in White, No. 1
    "1236",   # Woman Holding a Balance
    "11624", "9970", "35134",  # The Three Crosses (등록본 + 같은 판화의 다른 인쇄본)
}

REGISTERED_TITLE_KEYWORDS = [
    "wheat field with cypresses", "ia orana maria", "repast of the lion", "kanagawa", "great wave",
    "melencolia", "circus sideshow", "parade de cirque", "the harvesters", "grande jatte",
    "the bedroom", "paris street; rainy day", "at the moulin rouge", "water lilies",
    "mild breeze on a fine day", "fine wind, clear morning", "red fuji", "gaifu kaisei",
    "sudden shower", "ohashi", "three crosses", "farmhouse in provence", "girl with a watering can",
    "woman with a parasol", "symphony in white", "woman holding a balance",
]

EXCLUDED_OBJECT_IDS = REGISTERED_NGA_OBJECT_IDS | {item["object_id"] for item in UNREGISTERED}
