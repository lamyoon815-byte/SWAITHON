"""Export only artwork images and public metadata for the music team.

Run from the repository root:
  Backend/.venv/bin/python Backend/export_ai_music.py --base-url http://YOUR_IP:8004
  Backend/.venv/bin/python -m http.server 8004 --bind 0.0.0.0 --directory Backend/data/ai-share
"""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import zipfile

from PIL import Image

HERE = Path(__file__).resolve().parent
FIELDS = ("id", "title", "original_title", "artist", "original_artist", "year", "museum", "museum_id",
          "museum_area", "background", "source_url", "license", "description", "review_status")


def collect_records():
    records = {}
    # Finished manifests. Sources files contain download URLs, not catalog records.
    for path in sorted(HERE.glob("catalog*.json")):
        if path.name.endswith(".sources.json"):
            continue
        for record in json.loads(path.read_text(encoding="utf-8")):
            if isinstance(record, dict) and record.get("id") and record.get("image_path"):
                records[record["id"]] = (record, HERE / record["image_path"])

    # The collector writes its final manifest only after all downloads finish.
    # Reproduce its exact ID assignment from the saved metadata/name cache so that
    # completed images are available while the remaining downloads are running.
    gathered = HERE / "data/open-access/gathered.json"
    names_path = HERE / "data/open-access/korean-names.json"
    if gathered.exists() and names_path.exists():
        try:
            from .fetch_open_access import MUSEUMS, existing_state
        except ImportError:
            from fetch_open_access import MUSEUMS, existing_state
        names = json.loads(names_path.read_text(encoding="utf-8"))
        _, counter = existing_state()
        for item in json.loads(gathered.read_text(encoding="utf-8")):
            name = names.get(f"{item['original_title']}|{item['original_artist']}")
            if not name:
                continue
            museum_id = item["museum_id"]
            counter[museum_id] = counter.get(museum_id, 0) + 1
            artwork_id = f"{museum_id}-{counter[museum_id]:02d}"
            record = {**item, **MUSEUMS[museum_id], "id": artwork_id, "title": name[0],
                      "artist": name[1], "review_status": "pending"}
            records.setdefault(artwork_id, (record, HERE / f"data/open-access/{artwork_id}.jpg"))

    # Registered records are authoritative and retain any reviewed descriptions.
    db = HERE / "data/catalog.sqlite3"
    if db.exists():
        with closing(sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True)) as connection:
            for raw, filename in connection.execute("SELECT metadata_json, image_filename FROM artworks"):
                record = json.loads(raw)
                records[record["id"]] = (record, HERE / "data/images" / filename)
    return records


def export(output, base_url):
    output.mkdir(parents=True, exist_ok=True)
    (output / "images").mkdir(exist_ok=True)
    items, missing, invalid = [], [], []
    for artwork_id, (record, source) in sorted(collect_records().items()):
        if not source.is_file():
            missing.append(artwork_id)
            continue
        try:
            content = source.read_bytes()
            with Image.open(BytesIO(content)) as image:
                width, height = image.size
                extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(image.format)
                image.verify()
            if extension is None:
                raise ValueError("unsupported image type")
        except (OSError, ValueError, SyntaxError):
            invalid.append(artwork_id)
            continue
        digest = sha256(content).hexdigest()
        relative = f"images/{digest}{extension}"
        destination = output / relative
        if not destination.exists():
            # A snapshot, independent of collector files which may still be growing.
            temporary = destination.with_suffix(".tmp")
            temporary.write_bytes(content)
            os.replace(temporary, destination)
        item = {field: record[field] for field in FIELDS if field in record}
        item.update(image_path=relative, image_url=f"{base_url.rstrip('/')}/{relative}",
                    sha256=digest, width=width, height=height)
        items.append(item)
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "total": len(items),
                "missing_count": len(missing), "invalid_count": len(invalid), "items": items}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "collection-status.json").write_text(json.dumps({"missing": missing, "invalid": invalid}, ensure_ascii=False), encoding="utf-8")
    (output / "index.html").write_text(GALLERY, encoding="utf-8")
    (output / "README.txt").write_text(
        "MoMi music generation dataset\n\nmanifest.json: items contains artwork IDs, titles, artists, source/license metadata, image_path and image_url.\n"
        "Use image_url from another laptop on the same Wi-Fi. The server laptop must stay awake.\n"
        "After extracting ZIP, use image_path relative to the extracted directory.\n"
        "Return generated music with the original artwork id (e.g. {artwork_id: 'aic-08', music_file: 'aic-08.wav'}).\n"
        "Preserve source_url/license attribution. Names and unreviewed descriptions can require review.\n"
        "This is a snapshot of finished downloads; run the export again for later downloads.\n", encoding="utf-8")
    archive = output / "momi-ai-music.zip"
    temporary = output / "momi-ai-music.zip.tmp"
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as bundle:
        for name in ("manifest.json", "README.txt", "index.html", "collection-status.json"):
            bundle.write(output / name, name)
        for relative in sorted({item["image_path"] for item in items}):
            bundle.write(output / relative, relative)
    os.replace(temporary, archive)
    print(json.dumps({"total": len(items), "unique_images": len({item['sha256'] for item in items}),
                      "missing": len(missing), "invalid": len(invalid), "zip_bytes": archive.stat().st_size,
                      "by_museum": dict(Counter(item.get('museum_id') for item in items)),
                      "gallery": base_url, "manifest": base_url + "/manifest.json"}, ensure_ascii=False))


GALLERY = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoMi · 음악 생성용 작품 모음</title><style>
body{margin:0;background:#1c1d21;color:#ededef;font:16px system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px 20px}h1{color:#e1ad21}a{color:#e1ad21}input,button{padding:12px;border-radius:10px;border:1px solid #70747f;background:#2a2c31;color:#ededef;font:inherit}input{width:min(90%,480px)}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:24px 0}article{background:#2a2c31;border-radius:14px;overflow:hidden}article img{width:100%;height:200px;object-fit:contain;background:#111}article div{padding:12px}h2{font-size:17px;margin:0 0 6px}p{color:#b4b8c0;line-height:1.6}.controls{display:flex;gap:16px;align-items:center}small{word-break:break-all}</style>
<main><h1>MoMi · 음악 생성용 작품 모음</h1><p id="summary">목록 불러오는 중…</p><p><a href="manifest.json">작품 정보 JSON</a> · <a href="momi-ai-music.zip">전체 이미지 + 정보 ZIP 다운로드</a> · <a href="README.txt">연동 안내</a></p><input id="search" placeholder="제목, 작가, 작품 ID 검색" aria-label="작품 검색"><div id="grid"></div><div class="controls"><button id="prev">이전</button><span id="page"></span><button id="next">다음</button></div></main>
<script>
let all=[],filtered=[],page=0;const size=48,$=id=>document.getElementById(id);
function text(tag,value){const el=document.createElement(tag);el.textContent=value||'';return el}
function render(){const grid=$('grid');grid.replaceChildren();for(const item of filtered.slice(page*size,(page+1)*size)){const card=document.createElement('article'),link=document.createElement('a'),img=document.createElement('img'),body=document.createElement('div');link.href=item.image_path;link.target='_blank';link.rel='noopener';img.src=item.image_path;img.loading='lazy';img.alt=item.title||item.id;link.append(img);body.append(text('h2',item.title),text('p',[item.artist,item.year].filter(Boolean).join(' · ')),text('small',item.id));card.append(link,body);grid.append(card)}$('page').textContent=`${page+1} / ${Math.max(1,Math.ceil(filtered.length/size))} · ${filtered.length}점`;$('prev').disabled=page===0;$('next').disabled=(page+1)*size>=filtered.length}
$('search').oninput=()=>{const q=$('search').value.toLowerCase();filtered=all.filter(x=>[x.id,x.title,x.artist,x.original_title,x.original_artist].some(v=>String(v||'').toLowerCase().includes(q)));page=0;render()};$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};fetch('manifest.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{all=data.items;filtered=all;$('summary').textContent=`다운로드 완료 작품 ${data.total.toLocaleString()}점 · 갱신 ${new Date(data.created_at).toLocaleString('ko-KR')} · 추가 수집분은 다음 갱신에 포함됩니다.`;render()}).catch(()=>{$('summary').textContent='목록을 불러오지 못했습니다. 서버 연결을 확인해 주세요.'});
</script></html>'''

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "data/ai-share")
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    export(args.output.resolve(), args.base_url.rstrip("/"))
