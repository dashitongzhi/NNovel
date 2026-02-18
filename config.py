import os


def _normalize_path(value):
    text = str(value or "").strip()
    if not text:
        return ""
    text = os.path.expandvars(os.path.expanduser(text))
    if not os.path.isabs(text):
        text = os.path.abspath(text)
    return os.path.normpath(text)


def _local_appdata_dir():
    value = _normalize_path(os.environ.get("LOCALAPPDATA", ""))
    if value:
        return value
    user_profile = _normalize_path(os.environ.get("USERPROFILE", ""))
    if user_profile:
        return _normalize_path(os.path.join(user_profile, "AppData", "Local"))
    return ""


def _is_writable_dir(path):
    target = str(path or "").strip()
    if not target:
        return False
    try:
        os.makedirs(target, exist_ok=True)
        probe = os.path.join(target, f".nnovel-write-probe-{os.getpid()}")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(probe)
        return True
    except OSError:
        return False


def _resolve_runtime_root():
    source_dir = _normalize_path(os.path.dirname(os.path.abspath(__file__)))
    env_root = _normalize_path(os.environ.get("NNOVEL_RUNTIME_ROOT", ""))
    local_appdata = _local_appdata_dir()

    candidates = []
    if env_root:
        candidates.append(env_root)
    if local_appdata:
        candidates.append(os.path.join(local_appdata, "Writer"))
    candidates.append(source_dir)

    seen = set()
    for candidate in candidates:
        text = str(candidate or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        if _is_writable_dir(text):
            return text
    return source_dir


# Runtime data root:
# - Prefer NNOVEL_RUNTIME_ROOT only when writable.
# - Otherwise fall back to LOCALAPPDATA/Writer.
# - Final fallback: current source directory.
PROJECT_DIR = _resolve_runtime_root()
DATA_DIR = os.path.join(PROJECT_DIR, "data")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "novel")
CODEX_TIMEOUT = 120
GEMINI_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT", "300"))
PORT = 5000
CHARS_PER_BATCH = int(os.environ.get("CHARS_PER_BATCH", "2000"))
