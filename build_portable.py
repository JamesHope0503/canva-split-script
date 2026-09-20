import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = ROOT / ".venv" / "Scripts" / "python.exe"
DIST_DIR = ROOT / "dist"
BUILD_DIR = ROOT / "build"
RELEASE_DIR = ROOT / "release"
DIST_EXE = DIST_DIR / "SplitCanva.exe"


def app_version():
    text = (ROOT / "app.py").read_text(encoding="utf-8")
    match = re.search(r'APP_VERSION\s*=\s*"(\d+\.\d+\.\d+)"', text)
    if not match:
        raise SystemExit("APP_VERSION not found in app.py")
    return match.group(1)


def run(args):
    print("+", " ".join(str(a) for a in args), flush=True)
    subprocess.check_call(args, cwd=ROOT)


def main():
    version = app_version()
    exe_name = f"Canva分割文案-v{version}.exe"
    dest = RELEASE_DIR / exe_name

    python = str(PY if PY.exists() else sys.executable)
    run([python, "-m", "pip", "install", "-q", "pyinstaller>=6.0,<7"])
    run([
        python, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath", str(DIST_DIR),
        "--workpath", str(BUILD_DIR),
        str(ROOT / "split_script.spec"),
    ])

    if not DIST_EXE.exists():
        raise SystemExit(f"build missing: {DIST_EXE}")

    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DIST_EXE, dest)
    shutil.rmtree(DIST_DIR, ignore_errors=True)
    shutil.rmtree(BUILD_DIR, ignore_errors=True)
    print(f"OK {dest}")


if __name__ == "__main__":
    main()
