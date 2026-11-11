# 음악 생성용 작품 이미지 전달

같은 와이파이에서 아래 주소를 사용합니다. 서버 노트북이 켜져 있고 잠자기에 들어가지 않아야 합니다.

- 작품 목록/검색: http://172.20.102.74:8004/
- 작품 메타데이터: http://172.20.102.74:8004/manifest.json
- 전체 이미지와 메타데이터 ZIP: http://172.20.102.74:8004/momi-ai-music.zip

공유 주소는 이미지 전용 서버입니다. 기본 백엔드의 `/artworks`에 아직 등록되지 않은 다운로드 완료 작품도 포함합니다. 회원 DB·인증 정보는 포함하지 않습니다. IP가 바뀌면 아래 내보내기 명령의 `--base-url`을 바꾸어 다시 실행합니다.

## AI 코드에서 이미지 받기

`manifest.json`의 `items`를 순회합니다. `id`가 음악과 작품을 연결하는 기준이며 `title`, `artist`, `year`, `background`, `description`, `source_url`, `license`가 있으면 참고합니다. `description`은 없는 작품도 있습니다. 해설이나 한국어 제목은 미검수일 수 있으므로 사실 검증 완료 자료로 간주하지 않습니다.

```python
import json
from pathlib import Path
from urllib.request import urlopen

base = "http://172.20.102.74:8004"
with urlopen(base + "/manifest.json", timeout=30) as response:
    items = json.load(response)["items"]

output = Path("momi-images")
output.mkdir(exist_ok=True)
for item in items:
    filename = output / (item["id"] + Path(item["image_path"]).suffix)
    if not filename.exists():
        with urlopen(item["image_url"], timeout=60) as response:
            filename.write_bytes(response.read())
    # filename을 이미지 입력으로 사용해 음악을 생성합니다.
    # 결과에 반드시 item['id']를 함께 보관합니다.
```

전체 ZIP을 받았다면 압축을 푼 폴더의 `manifest.json`을 읽고, `image_path` 상대 경로로 이미지를 사용하면 됩니다. 출처와 이용 조건도 보존합니다.

음악 결과 전달 예시:

```json
{"artwork_id": "aic-08", "music_file": "music/aic-08.wav"}
```

## 수집분 갱신 및 서버 실행

프로젝트 루트에서 실행합니다. 진행 중인 수집 작업이나 백엔드 DB를 변경하지 않습니다. 파일이 없거나 이미지 검증에 실패한 항목은 이번 묶음에서 제외하며, `collection-status.json`에 기록합니다. 같은 이미지 파일은 콘텐츠 해시로 한 번만 묶지만, 각각의 작품 ID와 메타데이터는 유지합니다.

```sh
Backend/.venv/bin/python Backend/export_ai_music.py --base-url http://172.20.102.74:8004
Backend/.venv/bin/python -m http.server 8004 --bind 0.0.0.0 --directory Backend/data/ai-share
```

`Backend/data/ai-share/`는 Git 제외된 로컬 공유 자료입니다. ZIP을 Git에 올릴 필요는 없습니다. 공개 인터넷 접속 주소가 아니므로 Colab 등 외부 환경에서는 ZIP을 별도로 옮겨 사용합니다.
