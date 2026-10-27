"""Runpod image supervisor. No contestant notebook is executed automatically."""
import os
import signal
import subprocess
import time
from pathlib import Path

root = Path("/workspace")
root.mkdir(parents=True, exist_ok=True)
for name in ("data/public", "data/private", "Final/Tac_vu_1", "Final/Tac_vu_2", ".arena"):
    (root / name).mkdir(parents=True, exist_ok=True)
lock_note = root / "data/private/PRIVATE_LOCKED.txt"
lock_note.write_text("Private chưa mở. Agent chỉ tải và giải nén sau khi server xác nhận pha private.\n", encoding="utf-8")
token = os.environ["JUPYTER_TOKEN"]
# Kept out of argv and notebook files. Training mode intentionally allows terminal access.
os.environ["JUPYTER_TOKEN"] = token
processes = [
    subprocess.Popen(["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--ServerApp.root_dir=/workspace", "--ServerApp.allow_remote_access=True"]),
    subprocess.Popen(["uvicorn", "agent:app", "--host=0.0.0.0", "--port=8000", "--app-dir=/opt/arena", "--no-access-log"]),
]
def stop(*_):
    for process in processes:
        process.terminate()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while all(p.poll() is None for p in processes):
        time.sleep(1)
finally:
    stop()
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
