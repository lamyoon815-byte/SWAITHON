"""학교 시연용 단일 워커 감독 프로세스. 프로젝트 루트에서 -m Backend.run_demo."""
import argparse
from contextlib import closing
from datetime import datetime
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def backup_databases(data: Path) -> Path:
    """실행 중인 SQLite도 일관된 스냅샷으로 백업. 생성 음성 캐시는 복사하지 않는다."""
    target = data / "demo-backups" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target.mkdir(parents=True, mode=0o700)
    for name in ("catalog.sqlite3", "users.sqlite3", "voice-answers.sqlite3"):
        source = data / name
        if source.exists():
            with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=10)) as src:
                with closing(sqlite3.connect(target / name)) as dst:
                    src.backup(dst)
            (target / name).chmod(0o600)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    load_dotenv(ROOT / "Backend/.env")
    data = Path(os.getenv("MOMI_DATA_DIR") or os.getenv("SWAITHON_DATA_DIR") or ROOT / "Backend/data").resolve()
    # 다른 서버를 죽이거나 이미 실행 중인 서버 위에 중복 기동하지 않는다.
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", args.port)) == 0:
            parser.error(f"{args.port} 포트가 사용 중입니다. 기존 서버를 정상 종료한 뒤 실행하세요.")
    data.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    log = logging.getLogger("momi-demo")
    log.setLevel(logging.INFO)
    handler = RotatingFileHandler(data / "demo-server.log", maxBytes=5 * 1024 * 1024, backupCount=3)
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    log.addHandler(handler)
    log.addHandler(logging.StreamHandler())
    log.info("DB backup: %s", backup_databases(data))
    stop = threading.Event()
    child = None

    def shutdown(signum, frame):
        stop.set()
        if child is not None and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    # macOS에서 서버를 켜 둔 동안 유휴 절전을 방지한다(덮개 닫기는 별개).
    awake = subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())]) if shutil.which("caffeinate") else None
    pidfile = data / "demo-supervisor.pid"
    pidfile.write_text(str(os.getpid()))
    environment = dict(os.environ, PYTHONUNBUFFERED="1")
    # 학교 네트워크에서 Hugging Face 재접속 없이 이미 받은 CLIP 모델 사용.
    environment.setdefault("HF_HUB_OFFLINE", "1")
    command = [sys.executable, "-m", "uvicorn", "Backend.main:app", "--host", "0.0.0.0",
               "--port", str(args.port), "--workers", "1", "--proxy-headers",
               "--forwarded-allow-ips", "127.0.0.1,::1", "--limit-concurrency", "64",
               "--timeout-keep-alive", "5", "--timeout-graceful-shutdown", "20", "--no-server-header"]

    def copy_output(process):
        for line in process.stdout:
            log.info(line.rstrip())

    delay = 2
    try:
        while not stop.is_set():
            started = time.monotonic()
            child = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True)
            reader = threading.Thread(target=copy_output, args=(child,), daemon=True)
            reader.start()
            while child.poll() is None and not stop.wait(0.5):
                pass
            if stop.is_set():
                break
            code = child.returncode
            reader.join(timeout=2)
            if stop.is_set():
                break
            if time.monotonic() - started > 60:
                delay = 2
            log.warning("Server exited (%s); restarting in %ss", code, delay)
            stop.wait(delay)
            delay = min(delay * 2, 30)
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=25)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        if awake is not None:
            awake.terminate()
            awake.wait()
        pidfile.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
