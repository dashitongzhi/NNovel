import copy
import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime

from config import DATA_DIR, PROJECT_DIR

_LOCK = threading.RLock()
_BOOKS_DIR = os.path.join(DATA_DIR, "books")
_LIBRARY_FILE = os.path.join(DATA_DIR, "library.json")
_LEGACY_PROJECT_FILE = os.path.join(DATA_DIR, "project.json")
_LEGACY_CHAPTERS_FILE = os.path.join(DATA_DIR, "chapters.json")
_SETTINGS_FILE = os.path.join(PROJECT_DIR, "settings.json")
_SETTINGS_BACKUP_FILE = os.path.join(PROJECT_DIR, "settings.prev.json")
_AUTH_FILE = os.path.join(PROJECT_DIR, "auth.json")
_AUTH_BACKUP_FILE = os.path.join(PROJECT_DIR, "auth.prev.json")
_CONFIG_VERSION = 3
_SETTINGS_VERSION = 1
_LIBRARY_VERSION = 1

_GLOBAL_CONFIG_FIELDS = (
    "engine_mode",
    "codex_model",
    "gemini_model",
    "claude_model",
    "doubao_model",
    "doubao_models",
    "word_target",
    "codex_access_mode",
    "gemini_access_mode",
    "claude_access_mode",
    "codex_reasoning_effort",
    "gemini_reasoning_effort",
    "claude_reasoning_effort",
    "doubao_reasoning_effort",
    "personal_models",
    "personal_model",
    "proxy_port",
)
_LEGACY_AUTH_FIELDS = {
    "codex_api_key": "OPENAI_API_KEY",
    "gemini_api_key": "GEMINI_API_KEY",
    "claude_api_key": "ANTHROPIC_API_KEY",
    "personal_api_key": "PERSONAL_API_KEY",
    "personal_base_url": "PERSONAL_BASE_URL",
    "doubao_api_key": "DOUBAO_API_KEY",
}
_AUTH_KEYS = (
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "ANTHROPIC_API_KEY",
    "PERSONAL_API_KEY",
    "PERSONAL_BASE_URL",
    "DOUBAO_API_KEY",
    "ARK_API_KEY",
)


def _now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _default_global_config():
    return {
        "engine_mode": "codex",
        "codex_model": "",
        "gemini_model": "",
        "claude_model": "sonnet",
        "doubao_model": "doubao-seed-1-6-251015",
        "doubao_models": "\n".join(
            [
                "doubao-seed-1-6-251015",
                "doubao-seed-1-6-lite-251015",
                "doubao-seed-1-6-flash-250828",
            ]
        ),
        "word_target": "",
        "codex_access_mode": "cli",
        "gemini_access_mode": "cli",
        "claude_access_mode": "cli",
        "codex_reasoning_effort": "medium",
        "gemini_reasoning_effort": "medium",
        "claude_reasoning_effort": "medium",
        "doubao_reasoning_effort": "medium",
        "personal_models": "deepseek-ai/deepseek-v3.2",
        "personal_model": "deepseek-ai/deepseek-v3.2",
        "proxy_port": "10808",
    }


def _default_settings():
    return {
        "settings_version": _SETTINGS_VERSION,
        "global": _default_global_config(),
        "updated_at": _now_text(),
    }


def _default_auth():
    return {key: "" for key in _AUTH_KEYS}


def _default_book_meta(book_id="default", title="默认作品", folder="default_book"):
    now = _now_text()
    return {
        "id": str(book_id or "default"),
        "title": str(title or "默认作品"),
        "folder": str(folder or "default_book"),
        "created_at": now,
        "updated_at": now,
    }


def _default_library():
    book = _default_book_meta()
    return {
        "library_version": _LIBRARY_VERSION,
        "active_book_id": book["id"],
        "books": [book],
        "updated_at": _now_text(),
    }


def _default_project():
    return {
        "config": {
            "config_version": _CONFIG_VERSION,
            "outline": "",
            "reference": "",
            "requirements": "",
            "word_target": "",
            "extra_settings": "",
            "global_memory": "",
            "global_memory_structured": {
                "人物": [],
                "地点": [],
                "状态": [],
                "关系": [],
            },
            "engine_mode": "codex",
            "codex_model": "",
            "gemini_model": "",
            "claude_model": "sonnet",
            "codex_access_mode": "cli",
            "gemini_access_mode": "cli",
            "claude_access_mode": "cli",
            "codex_reasoning_effort": "medium",
            "gemini_reasoning_effort": "medium",
            "claude_reasoning_effort": "medium",
            "doubao_reasoning_effort": "medium",
            "doubao_model": "doubao-seed-1-6-251015",
            "doubao_models": "\n".join(
                [
                    "doubao-seed-1-6-251015",
                    "doubao-seed-1-6-lite-251015",
                    "doubao-seed-1-6-flash-250828",
                ]
            ),
            "personal_models": "deepseek-ai/deepseek-v3.2",
            "personal_model": "deepseek-ai/deepseek-v3.2",
            "proxy_port": "10808",
        },
        "draft": {
            "content": "",
            "last_generated": "",
        },
        "cache": "",
        "stats": {
            "total_chars": 0,
            "total_chapters": 0,
        },
        "discarded_drafts": {
            "items": [],
            "next_id": 1,
        },
        "generation_checkpoint": {
            "active": False,
            "task_id": "",
            "request_id": "",
            "state": "",
            "outline": "",
            "reference": "",
            "requirements": "",
            "word_target": "",
            "reasoning_effort": "medium",
            "extra_settings": "",
            "global_memory": "",
            "partial_content": "",
            "resume_seed": "",
            "thinking": "",
            "updated_at": "",
            "created_at": "",
            "resumed_at": "",
            "resume_count": 0,
            "reason": "",
            "message": "",
        },
        "pause_snapshot": {
            "active": False,
            "task_id": "",
            "request_id": "",
            "content": "",
            "updated_at": "",
        },
    }


def _default_chapters():
    return {
        "chapters": [],
        "next_id": 1,
    }


def _ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(_BOOKS_DIR, exist_ok=True)


def _merge_defaults(data, defaults):
    if not isinstance(data, dict):
        return copy.deepcopy(defaults)
    merged = copy.deepcopy(defaults)
    for k, v in data.items():
        if k in merged and isinstance(merged[k], dict) and isinstance(v, dict):
            merged[k] = _merge_defaults(v, merged[k])
        else:
            merged[k] = v
    return merged


def _read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path, data):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _normalize_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _normalize_book_folder(folder):
    text = str(folder or "").strip().lower()
    text = re.sub(r"[^a-z0-9_-]+", "-", text)
    text = text.strip("-_")
    if not text:
        text = "book"
    return text[:64]


def _title_to_slug(title):
    raw = str(title or "").strip()
    if not raw:
        return "book"

    converted = raw
    try:
        from pypinyin import lazy_pinyin  # type: ignore

        converted = "".join(lazy_pinyin(raw))
    except Exception:
        converted = raw

    converted = converted.lower()
    converted = re.sub(r"[^a-z0-9]+", "-", converted)
    converted = converted.strip("-")
    if not converted:
        converted = "book"
    return converted[:64].strip("-") or "book"


def _book_paths_from_meta(meta):
    folder = _normalize_book_folder((meta or {}).get("folder", "default_book"))
    root_dir = os.path.join(_BOOKS_DIR, folder)
    return {
        "root_dir": root_dir,
        "project_file": os.path.join(root_dir, "project.json"),
        "chapters_file": os.path.join(root_dir, "chapters.json"),
        "output_dir": os.path.join(root_dir, "novel"),
    }


def _migrate_project_data(data):
    if not isinstance(data, dict):
        return _default_project()

    config = data.setdefault("config", {})
    if not isinstance(config, dict):
        config = {}
        data["config"] = config

    version = _normalize_int(config.get("config_version"), 1)
    if version < 2:
        if not str(config.get("personal_models", "") or "").strip():
            personal_model = str(config.get("personal_model", "") or "").strip()
            if personal_model:
                config["personal_models"] = personal_model
        config.setdefault("proxy_port", "10808")
        config.setdefault("claude_model", "sonnet")
        version = 2

    if version < 3:
        config.setdefault("codex_access_mode", "cli")
        config.setdefault("gemini_access_mode", "cli")
        config.setdefault("claude_access_mode", "cli")
        if not str(config.get("doubao_models", "") or "").strip():
            current = str(config.get("doubao_model", "") or "").strip()
            if current:
                config["doubao_models"] = current
            else:
                config["doubao_models"] = "\n".join(
                    [
                        "doubao-seed-1-6-251015",
                        "doubao-seed-1-6-lite-251015",
                        "doubao-seed-1-6-flash-250828",
                    ]
                )
        version = 3

    for legacy_key in _LEGACY_AUTH_FIELDS.keys():
        if legacy_key in config:
            config.pop(legacy_key, None)

    config["config_version"] = max(version, _CONFIG_VERSION)
    return data


def _normalize_auth_value(value):
    return str(value or "").strip()


def _normalize_auth_data(data):
    defaults = _default_auth()
    merged = _merge_defaults(data if isinstance(data, dict) else {}, defaults)
    out = {}
    for key in _AUTH_KEYS:
        out[key] = _normalize_auth_value(merged.get(key, ""))
    return out


def _load_auth_locked():
    defaults = _default_auth()
    if not os.path.exists(_AUTH_FILE):
        _write_json(_AUTH_FILE, defaults)
        return copy.deepcopy(defaults)

    try:
        data = _read_json(_AUTH_FILE)
    except Exception:
        _write_json(_AUTH_FILE, defaults)
        return copy.deepcopy(defaults)

    normalized = _normalize_auth_data(data)
    if normalized != data:
        _write_json(_AUTH_FILE, normalized)
    return normalized


def _save_auth_locked(data, keep_backup=True):
    normalized = _normalize_auth_data(data)
    if keep_backup and os.path.exists(_AUTH_FILE):
        try:
            with open(_AUTH_FILE, "r", encoding="utf-8") as src, open(_AUTH_BACKUP_FILE, "w", encoding="utf-8") as dst:
                dst.write(src.read())
        except Exception:
            pass
    _write_json(_AUTH_FILE, normalized)
    return normalized


def _migrate_legacy_auth_fields_locked(config, auth):
    if not isinstance(config, dict):
        return False, False
    if not isinstance(auth, dict):
        return False, False

    cfg_changed = False
    auth_changed = False
    for legacy_key, auth_key in _LEGACY_AUTH_FIELDS.items():
        if legacy_key not in config:
            continue
        value = _normalize_auth_value(config.get(legacy_key, ""))
        config.pop(legacy_key, None)
        cfg_changed = True
        if value and not _normalize_auth_value(auth.get(auth_key, "")):
            auth[auth_key] = value
            auth_changed = True
    return cfg_changed, auth_changed


def _load_settings_locked():
    defaults = _default_settings()
    if not os.path.exists(_SETTINGS_FILE):
        _write_json(_SETTINGS_FILE, defaults)
        return copy.deepcopy(defaults)

    try:
        data = _read_json(_SETTINGS_FILE)
    except Exception:
        _write_json(_SETTINGS_FILE, defaults)
        return copy.deepcopy(defaults)

    merged = _merge_defaults(data, defaults)
    auth = _load_auth_locked()
    global_cfg = merged.get("global", {}) if isinstance(merged, dict) else {}
    cfg_changed, auth_changed = _migrate_legacy_auth_fields_locked(global_cfg, auth)
    if cfg_changed:
        merged["global"] = global_cfg
    changed = (merged != data) or cfg_changed
    if changed:
        _write_json(_SETTINGS_FILE, merged)
    if auth_changed:
        _save_auth_locked(auth, keep_backup=False)
    return merged


def _save_settings_locked(data, keep_backup=True):
    merged = _merge_defaults(data, _default_settings())
    auth = _load_auth_locked()
    global_cfg = merged.get("global", {}) if isinstance(merged, dict) else {}
    cfg_changed, auth_changed = _migrate_legacy_auth_fields_locked(global_cfg, auth)
    if cfg_changed:
        merged["global"] = global_cfg
    merged["settings_version"] = max(_normalize_int(merged.get("settings_version"), 1), _SETTINGS_VERSION)
    merged["updated_at"] = _now_text()
    if keep_backup and os.path.exists(_SETTINGS_FILE):
        try:
            with open(_SETTINGS_FILE, "r", encoding="utf-8") as src, open(_SETTINGS_BACKUP_FILE, "w", encoding="utf-8") as dst:
                dst.write(src.read())
        except Exception:
            pass
    _write_json(_SETTINGS_FILE, merged)
    if auth_changed:
        _save_auth_locked(auth, keep_backup=True)
    return merged


def _normalize_book_meta(item):
    if not isinstance(item, dict):
        item = {}
    book_id = str(item.get("id", "") or "").strip() or f"book_{uuid.uuid4().hex[:8]}"
    title = str(item.get("title", "") or "").strip() or "未命名作品"
    folder = _normalize_book_folder(item.get("folder", _title_to_slug(title)))
    created_at = str(item.get("created_at", "") or "").strip() or _now_text()
    updated_at = str(item.get("updated_at", "") or "").strip() or created_at
    return {
        "id": book_id,
        "title": title,
        "folder": folder,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _load_library_locked():
    defaults = _default_library()
    if not os.path.exists(_LIBRARY_FILE):
        _write_json(_LIBRARY_FILE, defaults)
        return copy.deepcopy(defaults)

    try:
        data = _read_json(_LIBRARY_FILE)
    except Exception:
        _write_json(_LIBRARY_FILE, defaults)
        return copy.deepcopy(defaults)

    merged = _merge_defaults(data, defaults)
    books_raw = merged.get("books", [])
    if not isinstance(books_raw, list):
        books_raw = []

    books = []
    ids = set()
    folders = set()
    for item in books_raw:
        meta = _normalize_book_meta(item)
        if meta["id"] in ids:
            meta["id"] = f"{meta['id']}_{uuid.uuid4().hex[:4]}"
        ids.add(meta["id"])

        base_folder = meta["folder"]
        folder = base_folder
        seq = 2
        while folder in folders:
            folder = _normalize_book_folder(f"{base_folder}-{seq}")
            seq += 1
        meta["folder"] = folder
        folders.add(folder)
        books.append(meta)

    if not books:
        books = [_default_book_meta()]

    active_id = str(merged.get("active_book_id", "") or "").strip()
    if active_id not in {b["id"] for b in books}:
        active_id = books[0]["id"]

    normalized = {
        "library_version": max(_normalize_int(merged.get("library_version"), 1), _LIBRARY_VERSION),
        "active_book_id": active_id,
        "books": books,
        "updated_at": str(merged.get("updated_at", "") or _now_text()),
    }

    if normalized != data:
        _write_json(_LIBRARY_FILE, normalized)
    return normalized


def _save_library_locked(data):
    normalized = _merge_defaults(data, _default_library())
    normalized["library_version"] = max(_normalize_int(normalized.get("library_version"), 1), _LIBRARY_VERSION)
    normalized["updated_at"] = _now_text()
    _write_json(_LIBRARY_FILE, normalized)
    return normalized


def _get_active_book_meta_locked(library):
    if not isinstance(library, dict):
        library = _load_library_locked()
    active_id = str(library.get("active_book_id", "") or "")
    books = library.get("books", []) if isinstance(library.get("books"), list) else []
    for item in books:
        if isinstance(item, dict) and str(item.get("id", "") or "") == active_id:
            return _normalize_book_meta(item)
    if books:
        return _normalize_book_meta(books[0])
    return _default_book_meta()


def _ensure_book_files_locked(meta):
    paths = _book_paths_from_meta(meta)
    os.makedirs(paths["root_dir"], exist_ok=True)
    os.makedirs(paths["output_dir"], exist_ok=True)

    if not os.path.exists(paths["project_file"]):
        _write_json(paths["project_file"], _default_project())
    if not os.path.exists(paths["chapters_file"]):
        _write_json(paths["chapters_file"], _default_chapters())
    return paths


def _migrate_legacy_files_locked(library):
    if not os.path.exists(_LEGACY_PROJECT_FILE) and not os.path.exists(_LEGACY_CHAPTERS_FILE):
        return

    meta = _get_active_book_meta_locked(library)
    paths = _ensure_book_files_locked(meta)

    def _is_default_like(path, defaults):
        if not os.path.exists(path):
            return True
        try:
            loaded = _read_json(path)
            merged = _merge_defaults(loaded, defaults)
            return merged == defaults
        except Exception:
            return True

    if os.path.exists(_LEGACY_PROJECT_FILE) and _is_default_like(paths["project_file"], _default_project()):
        try:
            os.replace(_LEGACY_PROJECT_FILE, paths["project_file"])
        except Exception:
            pass
    if os.path.exists(_LEGACY_CHAPTERS_FILE) and _is_default_like(paths["chapters_file"], _default_chapters()):
        try:
            os.replace(_LEGACY_CHAPTERS_FILE, paths["chapters_file"])
        except Exception:
            pass


def _sync_project_from_global_locked(project):
    settings = _load_settings_locked()
    global_cfg = settings.get("global", {}) if isinstance(settings, dict) else {}
    if not isinstance(global_cfg, dict):
        global_cfg = {}

    cfg = project.setdefault("config", {})
    if not isinstance(cfg, dict):
        cfg = {}
        project["config"] = cfg

    changed = False
    for key in _GLOBAL_CONFIG_FIELDS:
        current = cfg.get(key, "")
        if str(current or "").strip():
            continue
        fallback = global_cfg.get(key, "")
        if str(fallback or "").strip():
            cfg[key] = fallback
            changed = True
    return changed


def _sync_global_from_project_locked(project):
    if not isinstance(project, dict):
        return
    cfg = project.get("config", {})
    if not isinstance(cfg, dict):
        return

    settings = _load_settings_locked()
    global_cfg = settings.setdefault("global", {})
    changed = False
    for key in _GLOBAL_CONFIG_FIELDS:
        value = cfg.get(key, "")
        if str(value or "") != str(global_cfg.get(key, "") or ""):
            global_cfg[key] = value
            changed = True
    if changed:
        _save_settings_locked(settings, keep_backup=True)


def _read_project_file_locked(path):
    defaults = _default_project()
    if not os.path.exists(path):
        _write_json(path, defaults)
        return copy.deepcopy(defaults), True

    try:
        data = _read_json(path)
    except Exception:
        _write_json(path, defaults)
        return copy.deepcopy(defaults), True

    merged = _merge_defaults(data, defaults)
    merged = _migrate_project_data(merged)
    auth = _load_auth_locked()
    cfg = merged.get("config", {}) if isinstance(merged, dict) else {}
    cfg_changed, auth_changed = _migrate_legacy_auth_fields_locked(cfg, auth)
    if cfg_changed:
        merged["config"] = cfg
    if auth_changed:
        _save_auth_locked(auth, keep_backup=False)
    changed = merged != data
    return merged, changed


def _read_chapters_file_locked(path):
    defaults = _default_chapters()
    if not os.path.exists(path):
        _write_json(path, defaults)
        return copy.deepcopy(defaults), True

    try:
        data = _read_json(path)
    except Exception:
        _write_json(path, defaults)
        return copy.deepcopy(defaults), True

    merged = _merge_defaults(data, defaults)
    if not isinstance(merged.get("chapters"), list):
        merged["chapters"] = []
    if not isinstance(merged.get("next_id"), int):
        merged["next_id"] = 1
    changed = merged != data
    return merged, changed


def _runtime_context_locked():
    _ensure_dir()
    _load_settings_locked()
    library = _load_library_locked()
    _migrate_legacy_files_locked(library)
    meta = _get_active_book_meta_locked(library)
    paths = _ensure_book_files_locked(meta)
    return library, meta, paths


# ---------- Settings file helpers ----------

def settings_file_path():
    return _SETTINGS_FILE


def settings_backup_file_path():
    return _SETTINGS_BACKUP_FILE


def auth_file_path():
    return _AUTH_FILE


def auth_backup_file_path():
    return _AUTH_BACKUP_FILE


def load_settings():
    with _LOCK:
        _ensure_dir()
        return copy.deepcopy(_load_settings_locked())


def save_settings(data, keep_backup=True):
    with _LOCK:
        _ensure_dir()
        return copy.deepcopy(_save_settings_locked(data, keep_backup=keep_backup))


def read_settings_text():
    with _LOCK:
        _ensure_dir()
        settings = _load_settings_locked()
        return json.dumps(settings, ensure_ascii=False, indent=2)


def write_settings_text(raw_text, keep_backup=True):
    parsed = json.loads(str(raw_text or ""))
    with _LOCK:
        _ensure_dir()
        saved = _save_settings_locked(parsed, keep_backup=keep_backup)
        return copy.deepcopy(saved)


def restore_settings_backup():
    with _LOCK:
        _ensure_dir()
        if not os.path.exists(_SETTINGS_BACKUP_FILE):
            return None
        try:
            data = _read_json(_SETTINGS_BACKUP_FILE)
        except Exception:
            return None
        saved = _save_settings_locked(data, keep_backup=False)
        return copy.deepcopy(saved)


def load_auth():
    with _LOCK:
        _ensure_dir()
        return copy.deepcopy(_load_auth_locked())


def save_auth(data, keep_backup=True):
    with _LOCK:
        _ensure_dir()
        return copy.deepcopy(_save_auth_locked(data, keep_backup=keep_backup))


def read_auth_text():
    with _LOCK:
        _ensure_dir()
        auth = _load_auth_locked()
        return json.dumps(auth, ensure_ascii=False, indent=2)


def write_auth_text(raw_text, keep_backup=True):
    parsed = json.loads(str(raw_text or ""))
    with _LOCK:
        _ensure_dir()
        saved = _save_auth_locked(parsed, keep_backup=keep_backup)
        return copy.deepcopy(saved)


def restore_auth_backup():
    with _LOCK:
        _ensure_dir()
        if not os.path.exists(_AUTH_BACKUP_FILE):
            return None
        try:
            data = _read_json(_AUTH_BACKUP_FILE)
        except Exception:
            return None
        saved = _save_auth_locked(data, keep_backup=False)
        return copy.deepcopy(saved)


# ---------- Book shelf helpers ----------

def get_bookshelf():
    with _LOCK:
        _, meta, paths = _runtime_context_locked()
        library = _load_library_locked()
        return {
            "active_book_id": meta["id"],
            "active_book": meta,
            "active_paths": paths,
            "books": copy.deepcopy(library.get("books", [])),
        }


def list_books():
    return get_bookshelf().get("books", [])


def get_active_book():
    return get_bookshelf().get("active_book")


def get_active_output_dir():
    return get_bookshelf().get("active_paths", {}).get("output_dir", os.path.join(PROJECT_DIR, "novel"))


def get_active_book_paths():
    return get_bookshelf().get("active_paths", {})


def _ensure_unique_folder_locked(base_slug):
    slug = _normalize_book_folder(base_slug)
    library = _load_library_locked()
    used = {str(b.get("folder", "") or "") for b in library.get("books", []) if isinstance(b, dict)}
    if slug not in used:
        return slug
    seq = 2
    while True:
        candidate = _normalize_book_folder(f"{slug}-{seq}")
        if candidate not in used:
            return candidate
        seq += 1


def create_book(title, set_active=True):
    with _LOCK:
        _ensure_dir()
        library = _load_library_locked()
        clean_title = str(title or "").strip() or "未命名作品"
        base_slug = _title_to_slug(clean_title)
        folder = _ensure_unique_folder_locked(base_slug)
        now = _now_text()
        book_id = f"book_{uuid.uuid4().hex[:8]}"
        meta = {
            "id": book_id,
            "title": clean_title,
            "folder": folder,
            "created_at": now,
            "updated_at": now,
        }
        books = library.get("books", []) if isinstance(library.get("books"), list) else []
        books.append(meta)
        library["books"] = books
        if set_active:
            library["active_book_id"] = book_id
        library["updated_at"] = now
        _save_library_locked(library)
        _ensure_book_files_locked(meta)
        return copy.deepcopy(meta), _book_paths_from_meta(meta)


def switch_book(book_id):
    target = str(book_id or "").strip()
    if not target:
        return None

    with _LOCK:
        _, _, _ = _runtime_context_locked()
        library = _load_library_locked()
        books = library.get("books", []) if isinstance(library.get("books"), list) else []
        found = None
        for item in books:
            if isinstance(item, dict) and str(item.get("id", "") or "") == target:
                found = _normalize_book_meta(item)
                break
        if not found:
            return None

        library["active_book_id"] = found["id"]
        library["updated_at"] = _now_text()
        _save_library_locked(library)
        paths = _ensure_book_files_locked(found)
        return {"book": copy.deepcopy(found), "paths": paths}


def delete_book(book_id):
    target = str(book_id or "").strip()
    if not target:
        return None

    with _LOCK:
        _ensure_dir()
        library = _load_library_locked()
        books_raw = library.get("books", []) if isinstance(library.get("books"), list) else []
        books = [_normalize_book_meta(item) for item in books_raw if isinstance(item, dict)]

        target_meta = None
        remaining = []
        for meta in books:
            if meta["id"] == target:
                target_meta = meta
            else:
                remaining.append(meta)

        if not target_meta:
            return None

        target_paths = _book_paths_from_meta(target_meta)
        target_root = os.path.abspath(target_paths["root_dir"])
        books_root = os.path.abspath(_BOOKS_DIR)
        try:
            common_root = os.path.commonpath([target_root, books_root])
        except ValueError:
            return None
        if common_root != books_root:
            return None

        if os.path.isdir(target_root):
            try:
                shutil.rmtree(target_root)
            except Exception:
                return None

        if not remaining:
            fallback_id = f"book_{uuid.uuid4().hex[:8]}"
            fallback_folder = _normalize_book_folder(f"book-{uuid.uuid4().hex[:8]}")
            remaining = [_default_book_meta(book_id=fallback_id, title="未命名作品", folder=fallback_folder)]

        remaining_ids = {meta["id"] for meta in remaining}
        active_id = str(library.get("active_book_id", "") or "").strip()
        if active_id not in remaining_ids:
            active_id = remaining[0]["id"]

        library["books"] = remaining
        library["active_book_id"] = active_id
        library["updated_at"] = _now_text()
        _save_library_locked(library)

        active_meta = remaining[0]
        for meta in remaining:
            if meta["id"] == active_id:
                active_meta = meta
                break
        paths = _ensure_book_files_locked(active_meta)

        return {
            "deleted": copy.deepcopy(target_meta),
            "active_book": copy.deepcopy(active_meta),
            "paths": paths,
        }


# ---------- Project/chapter persistence ----------

def load_project():
    with _LOCK:
        _, _, paths = _runtime_context_locked()
        merged, changed = _read_project_file_locked(paths["project_file"])
        if _sync_project_from_global_locked(merged):
            changed = True
        if changed:
            _write_json(paths["project_file"], merged)
        return copy.deepcopy(merged)


def save_project(data):
    with _LOCK:
        _, _, paths = _runtime_context_locked()
        merged = _merge_defaults(data, _default_project())
        merged = _migrate_project_data(merged)
        auth = _load_auth_locked()
        cfg = merged.get("config", {}) if isinstance(merged, dict) else {}
        _, auth_changed = _migrate_legacy_auth_fields_locked(cfg, auth)
        if isinstance(merged, dict):
            merged["config"] = cfg
        _sync_project_from_global_locked(merged)
        _write_json(paths["project_file"], merged)
        _sync_global_from_project_locked(merged)
        if auth_changed:
            _save_auth_locked(auth, keep_backup=True)


def load_chapters():
    with _LOCK:
        _, _, paths = _runtime_context_locked()
        merged, changed = _read_chapters_file_locked(paths["chapters_file"])
        if changed:
            _write_json(paths["chapters_file"], merged)
        return copy.deepcopy(merged)


def save_chapters(data):
    with _LOCK:
        _, _, paths = _runtime_context_locked()
        merged = _merge_defaults(data, _default_chapters())
        if not isinstance(merged.get("chapters"), list):
            merged["chapters"] = []
        if not isinstance(merged.get("next_id"), int):
            merged["next_id"] = 1
        _write_json(paths["chapters_file"], merged)
