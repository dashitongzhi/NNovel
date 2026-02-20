import threading
import uuid
import webbrowser
import subprocess
import os
import signal
import sys
from urllib.parse import quote
from datetime import datetime

from flask import Flask, jsonify, render_template, request, send_file

from chapter_manager import (
    ensure_output_dir,
    delete_chapter,
    get_chapter,
    list_chapters,
    normalize_memory_config_from_text,
    save_chapter_with_title,
    split_chapter,
)
from codex_engine import (
    THINKING_PHASES,
    generate_chapter_title,
    generate_outline,
    polish_draft,
    optimize_reference_prompt,
    generate_novel_with_progress,
    generate_chapter_context_pack,
    get_codex_status,
    get_startup_self_check,
    infer_error_code,
    test_engine_connectivity,
)
from config import PORT
from data_store import (
    auth_backup_file_path,
    auth_file_path,
    create_book,
    delete_book,
    get_active_book,
    get_active_book_paths,
    get_bookshelf,
    load_auth,
    load_settings,
    read_settings_text,
    read_auth_text,
    restore_auth_backup,
    restore_settings_backup,
    save_project,
    save_auth,
    save_settings,
    settings_backup_file_path,
    settings_file_path,
    switch_book,
    write_auth_text,
    write_settings_text,
    load_project,
)

_RESOURCES_ROOT = os.path.abspath(str(os.environ.get("NNOVEL_RESOURCES_ROOT", "") or os.path.dirname(os.path.abspath(__file__))))
_TEMPLATE_DIR = os.path.join(_RESOURCES_ROOT, "templates")
_STATIC_DIR = os.path.join(_RESOURCES_ROOT, "static")

app = Flask(__name__, template_folder=_TEMPLATE_DIR, static_folder=_STATIC_DIR)

generation_tasks = {}
_generation_lock = threading.Lock()
_prewarm_lock = threading.Lock()
_prewarm_started = False
_CACHE_TAIL_CHARS = 350
_DISCARDED_MAX_ITEMS = 200
_GEN_CHECKPOINT_KEY = "generation_checkpoint"
_PAUSE_SNAPSHOT_KEY = "pause_snapshot"
_DEFAULT_PERSONAL_MODEL = "deepseek-ai/deepseek-v3.2"
_BACKGROUND_DIR = os.path.join(_RESOURCES_ROOT, "background")
_BACKGROUND_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"}
_DEFAULT_DOUBAO_MODELS = (
    "doubao-seed-1-6-251015",
    "doubao-seed-1-6-lite-251015",
    "doubao-seed-1-6-flash-250828",
)
_SETTINGS_SYNC_FIELDS = (
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
_AUTH_MIGRATION_FIELDS = (
    ("codex_api_key", "OPENAI_API_KEY"),
    ("gemini_api_key", "GEMINI_API_KEY"),
    ("claude_api_key", "ANTHROPIC_API_KEY"),
    ("personal_api_key", "PERSONAL_API_KEY"),
    ("personal_base_url", "PERSONAL_BASE_URL"),
)


def _text(v):
    return str(v or "").strip()


def _effort(v):
    x = _text(v).lower()
    if x in {"low", "medium", "high"}:
        return x
    return "medium"


def _selected_effort_for_mode(
    engine_mode,
    codex_reasoning_effort="medium",
    gemini_reasoning_effort="medium",
    claude_reasoning_effort="medium",
    doubao_reasoning_effort="medium",
):
    mode = _text(engine_mode).lower()
    if mode == "gemini":
        return _effort(gemini_reasoning_effort)
    if mode == "claude":
        return _effort(claude_reasoning_effort)
    if mode == "doubao":
        return _effort(doubao_reasoning_effort)
    return _effort(codex_reasoning_effort)


def _access_mode(v):
    x = _text(v).lower()
    if x in {"cli", "api"}:
        return x
    return "cli"


def _proxy_port(v):
    x = _text(v)
    if not x:
        return "10808"
    try:
        n = int(x)
    except (TypeError, ValueError):
        return "10808"
    if 1 <= n <= 65535:
        return str(n)
    return "10808"


def _background_label(file_name):
    name = str(file_name or "").strip()
    if not name:
        return ""
    base, _ = os.path.splitext(name)
    return base.strip() or name


def _background_safe_path(file_name):
    raw_name = str(file_name or "").strip()
    if not raw_name:
        return ""
    base_name = os.path.basename(raw_name)
    if base_name != raw_name:
        return ""
    _, ext = os.path.splitext(base_name)
    if ext.lower() not in _BACKGROUND_EXTENSIONS:
        return ""
    target = os.path.realpath(os.path.join(_BACKGROUND_DIR, base_name))
    root = os.path.realpath(_BACKGROUND_DIR)
    if target != root and not target.startswith(root + os.sep):
        return ""
    if not os.path.isfile(target):
        return ""
    return target


def _list_background_items():
    rows = []
    if not os.path.isdir(_BACKGROUND_DIR):
        return rows

    try:
        entries = list(os.scandir(_BACKGROUND_DIR))
    except OSError:
        return rows

    for entry in entries:
        try:
            if not entry.is_file():
                continue
            file_name = str(entry.name or "").strip()
            if not file_name:
                continue
            _, ext = os.path.splitext(file_name)
            if ext.lower() not in _BACKGROUND_EXTENSIONS:
                continue
            stat = entry.stat()
            mtime = int(getattr(stat, "st_mtime", 0) or 0)
            rows.append(
                {
                    "id": file_name,
                    "name": _background_label(file_name),
                    "url": f"/api/background/file/{quote(file_name)}?v={mtime}",
                    "mtime": mtime,
                }
            )
        except OSError:
            continue

    rows.sort(key=lambda item: (str(item.get("name", "")).lower(), str(item.get("id", "")).lower()))
    return rows


def _apply_runtime_proxy_env(proxy_port):
    port = _proxy_port(proxy_port)
    proxy_url = f"http://127.0.0.1:{port}"
    prev_marked_port = _text(os.environ.get("NNOVEL_PROXY_PORT", ""))
    prev_proxy_url = f"http://127.0.0.1:{_proxy_port(prev_marked_port)}" if prev_marked_port else ""

    def _should_set_proxy(key):
        current = _text(os.environ.get(key, ""))
        if not current:
            return True
        # Keep user/system preconfigured proxies untouched.
        # Only refresh when the existing value was previously written by NNOVEL.
        if prev_proxy_url and current == prev_proxy_url:
            return True
        return False

    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        if _should_set_proxy(key):
            os.environ[key] = proxy_url
    if not _text(os.environ.get("NO_PROXY", "")):
        os.environ["NO_PROXY"] = "localhost,127.0.0.1,::1"
    if not _text(os.environ.get("no_proxy", "")):
        os.environ["no_proxy"] = "localhost,127.0.0.1,::1"
    os.environ["NNOVEL_PROXY_PORT"] = port
    os.environ["NNOVEL_PROXY_URL"] = proxy_url
    return port, proxy_url


def _apply_runtime_proxy_from_config(config):
    cfg = config if isinstance(config, dict) else {}
    return _apply_runtime_proxy_env(cfg.get("proxy_port", "10808"))


def _sync_proxy_port_everywhere(proxy_port):
    port = _proxy_port(proxy_port)
    project = load_project()
    cfg = project.setdefault("config", {})
    if not isinstance(cfg, dict):
        cfg = {}
        project["config"] = cfg
    cfg["proxy_port"] = port
    save_project(project)
    applied_port, proxy_url = _apply_runtime_proxy_env(port)
    return applied_port, proxy_url


def _config_version(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = 3
    return max(3, n)


def _auth_value(v):
    return str(v or "").strip()


def _auth_snapshot():
    raw = load_auth()
    if not isinstance(raw, dict):
        raw = {}
    return {
        "OPENAI_API_KEY": _auth_value(raw.get("OPENAI_API_KEY", "")),
        "GEMINI_API_KEY": _auth_value(raw.get("GEMINI_API_KEY", "")),
        "ANTHROPIC_API_KEY": _auth_value(raw.get("ANTHROPIC_API_KEY", "")),
        "PERSONAL_API_KEY": _auth_value(raw.get("PERSONAL_API_KEY", "")),
        "PERSONAL_BASE_URL": _auth_value(raw.get("PERSONAL_BASE_URL", "")),
    }


def _sync_doubao_auth_from_env_on_startup():
    auth = load_auth()
    if not isinstance(auth, dict):
        auth = {}

    existing_doubao = _auth_value(auth.get("DOUBAO_API_KEY", ""))
    existing_ark = _auth_value(auth.get("ARK_API_KEY", ""))
    if existing_doubao or existing_ark:
        return False

    env_doubao = _auth_value(os.environ.get("DOUBAO_API_KEY", ""))
    env_ark = _auth_value(os.environ.get("ARK_API_KEY", ""))
    if not env_doubao and not env_ark:
        return False

    changed = False
    if env_doubao:
        auth["DOUBAO_API_KEY"] = env_doubao
        changed = True
    if env_ark:
        auth["ARK_API_KEY"] = env_ark
        changed = True

    if changed:
        save_auth(auth, keep_backup=False)
    return changed


def _sync_auth_from_payload(data):
    if not isinstance(data, dict):
        return False, _auth_snapshot()
    auth = load_auth()
    if not isinstance(auth, dict):
        auth = {}
    changed = False
    for source_key, auth_key in _AUTH_MIGRATION_FIELDS:
        if source_key not in data:
            continue
        value = _auth_value(data.get(source_key, ""))
        if _auth_value(auth.get(auth_key, "")) != value:
            auth[auth_key] = value
            changed = True
    if changed:
        auth = save_auth(auth, keep_backup=True)
    return changed, auth if isinstance(auth, dict) else {}


def _sync_project_config_with_global_settings(force=False):
    settings = load_settings()
    global_cfg = settings.get("global", {}) if isinstance(settings.get("global"), dict) else {}
    project = load_project()
    config = project.setdefault("config", {})
    if not isinstance(config, dict):
        config = {}
        project["config"] = config

    changed = False
    for key in _SETTINGS_SYNC_FIELDS:
        value = global_cfg.get(key, "")
        if force:
            if str(config.get(key, "") or "") != str(value or ""):
                config[key] = value
                changed = True
        else:
            if str(config.get(key, "") or "").strip():
                continue
            if str(value or "").strip():
                config[key] = value
                changed = True

    if changed:
        save_project(project)
    return project, settings, changed


def _copy_model_config_fields(source_cfg, target_cfg):
    if not isinstance(source_cfg, dict) or not isinstance(target_cfg, dict):
        return False
    changed = False
    for key in _SETTINGS_SYNC_FIELDS:
        value = source_cfg.get(key, "")
        if str(target_cfg.get(key, "") or "") != str(value or ""):
            target_cfg[key] = value
            changed = True
    return changed


def _claude_model(v):
    x = _text(v).lower()
    if not x:
        return "sonnet"
    if x in {"opus", "sonnet", "haiku"}:
        return x

    # Backward compatibility: normalize previously stored full model IDs.
    if "opus" in x:
        return "opus"
    if "haiku" in x:
        return "haiku"
    if "sonnet" in x:
        return "sonnet"
    return "sonnet"


def _personal_model(v):
    x = _text(v)
    return x or _DEFAULT_PERSONAL_MODEL


def _personal_models(v):
    raw = str(v or "").replace("\r\n", "\n").replace("\r", "\n").replace(",", "\n")
    lines = []
    seen = set()
    for line in raw.split("\n"):
        item = _text(line)
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        lines.append(item)
    if not lines:
        lines = [_DEFAULT_PERSONAL_MODEL]
    return "\n".join(lines)


def _pick_current_model(models_text, preferred_model, fallback):
    models = [x for x in str(models_text or "").split("\n") if _text(x)]
    preferred = _text(preferred_model)
    if preferred:
        for model in models:
            if model.casefold() == preferred.casefold():
                return model
        # Keep explicit current model even if not present in list.
        return preferred
    return models[0] if models else fallback


def _personal_model_mirror(models_value, preferred_model=""):
    # Keep list order and allow current model to be selected independently.
    models_text = _personal_models(models_value)
    return _pick_current_model(models_text, preferred_model, _DEFAULT_PERSONAL_MODEL)


def _doubao_models(v):
    raw = str(v or "").replace("\r\n", "\n").replace("\r", "\n").replace(",", "\n")
    lines = []
    seen = set()
    for line in raw.split("\n"):
        item = _text(line)
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        lines.append(item)
    if not lines:
        lines = list(_DEFAULT_DOUBAO_MODELS)
    return "\n".join(lines)


def _doubao_model_mirror(models_value, preferred_model=""):
    models_text = _doubao_models(models_value)
    return _pick_current_model(models_text, preferred_model, _DEFAULT_DOUBAO_MODELS[0])


def _is_first_run_book_required(project, shelf):
    books = shelf.get("books", []) if isinstance(shelf, dict) else []
    active_book = shelf.get("active_book", {}) if isinstance(shelf, dict) else {}
    if not isinstance(books, list) or len(books) != 1:
        return False
    if not isinstance(active_book, dict):
        return False

    title = _text(active_book.get("title"))
    folder = _text(active_book.get("folder"))
    book_id = _text(active_book.get("id"))
    if not ((title == "默认作品") and (folder == "default_book") and (book_id == "default")):
        return False

    cfg = project.get("config", {}) if isinstance(project, dict) else {}
    if not isinstance(cfg, dict):
        cfg = {}
    draft = project.get("draft", {}) if isinstance(project, dict) else {}
    if not isinstance(draft, dict):
        draft = {}

    seed_fields = (
        cfg.get("outline", ""),
        cfg.get("reference", ""),
        cfg.get("requirements", ""),
        cfg.get("extra_settings", ""),
        cfg.get("global_memory", ""),
        draft.get("content", ""),
    )
    if any(_text(x) for x in seed_fields):
        return False

    try:
        chapters = list_chapters()
    except Exception:
        chapters = []
    return not bool(chapters)


def _cache_summary(text):
    text = str(text or "")
    if not text:
        return ""
    text = text.replace("\r\n", "\n").rstrip()
    if len(text) <= 400:
        return text
    return text[-_CACHE_TAIL_CHARS:]


def _generate_context_pack_with_timeout(full_text, existing_pack="", timeout_seconds=15):
    body = str(full_text or "").strip()
    if not body:
        return ""

    result = {"value": ""}

    def _job():
        try:
            result["value"] = generate_chapter_context_pack(body, existing_pack)
        except Exception:
            result["value"] = ""

    t = threading.Thread(target=_job, daemon=True)
    t.start()
    t.join(timeout=max(0.1, float(timeout_seconds or 0)))

    return str(result.get("value", "") or "").strip()


def _read_cache(project):
    draft = project.get("draft", {}) if isinstance(project, dict) else {}
    if isinstance(draft, dict):
        draft_content = str(draft.get("content", "") or "")
        if draft_content.strip():
            cache = project.get("cache", "")
            pack = ""
            if isinstance(cache, dict):
                pack = str(cache.get("context_pack", "") or "").strip()
            if pack:
                return pack + "\n\n【最近正文末尾】\n" + _cache_summary(draft_content)
            return _cache_summary(draft_content)

    cache = project.get("cache", "")
    if isinstance(cache, dict):
        pack = str(cache.get("context_pack", "") or "").strip()
        if pack:
            return pack
        cache = cache.get("summary", "")
    return _cache_summary(cache)


def _char_count(text):
    return len("".join(str(text or "").split()))


def _now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _log_with_request(request_id, message):
    rid = str(request_id or "").strip() or "-"
    print(f"[request_id={rid}] {message}")


def _ensure_discarded_store(project):
    store = project.setdefault("discarded_drafts", {})
    if not isinstance(store, dict):
        store = {"items": [], "next_id": 1}
        project["discarded_drafts"] = store
    if not isinstance(store.get("items"), list):
        store["items"] = []
    if not isinstance(store.get("next_id"), int):
        store["next_id"] = 1
    return store


def _append_discarded_draft(project, content):
    text = str(content or "").strip()
    if not text:
        return None

    store = _ensure_discarded_store(project)
    item_id = int(store.get("next_id", 1))
    item = {
        "id": item_id,
        "content": text,
        "char_count": _char_count(text),
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    store["items"].append(item)
    store["next_id"] = item_id + 1
    if len(store["items"]) > _DISCARDED_MAX_ITEMS:
        store["items"] = store["items"][-_DISCARDED_MAX_ITEMS:]
    return item


def _list_discarded_items(project):
    store = _ensure_discarded_store(project)
    items = [x for x in store.get("items", []) if isinstance(x, dict)]
    items.sort(key=lambda x: int(x.get("id", 0)), reverse=True)
    return items


def _normalize_memory_payload(global_memory_text, global_memory_structured=None):
    rendered, structured = normalize_memory_config_from_text(
        global_memory_text,
        global_memory_structured,
    )
    return rendered, structured


def _build_generation_checkpoint(
    *,
    task_id,
    outline,
    reference,
    requirements,
    word_target,
    extra_settings,
    global_memory,
    reasoning_effort="",
    partial_content="",
    thinking="",
    resume_seed="",
    state="running",
    request_id="",
):
    return {
        "active": True,
        "task_id": str(task_id or ""),
        "state": str(state or "running"),
        "request_id": str(request_id or ""),
        "outline": str(outline or ""),
        "reference": str(reference or ""),
        "requirements": str(requirements or ""),
        "word_target": str(word_target or ""),
        "reasoning_effort": _effort(reasoning_effort),
        "extra_settings": str(extra_settings or ""),
        "global_memory": str(global_memory or ""),
        "partial_content": str(partial_content or ""),
        "resume_seed": str(resume_seed or ""),
        "thinking": str(thinking or THINKING_PHASES[0][1]),
        "updated_at": _now_text(),
        "created_at": _now_text(),
    }


def _write_generation_checkpoint(project, checkpoint):
    if not isinstance(project, dict):
        return
    project[_GEN_CHECKPOINT_KEY] = checkpoint if isinstance(checkpoint, dict) else {}


def _clear_generation_checkpoint(project, reason=""):
    checkpoint = project.get(_GEN_CHECKPOINT_KEY, {})
    if not isinstance(checkpoint, dict):
        checkpoint = {}
    checkpoint["active"] = False
    checkpoint["state"] = "cleared"
    checkpoint["reason"] = str(reason or "")
    checkpoint["updated_at"] = _now_text()
    project[_GEN_CHECKPOINT_KEY] = checkpoint


def _write_pause_snapshot(project, *, task_id="", request_id="", content="", active=True):
    if not isinstance(project, dict):
        return
    snap = project.get(_PAUSE_SNAPSHOT_KEY, {})
    if not isinstance(snap, dict):
        snap = {}
    snap.update(
        {
            "active": bool(active),
            "task_id": str(task_id or ""),
            "request_id": str(request_id or ""),
            "content": str(content or ""),
            "updated_at": _now_text(),
        }
    )
    project[_PAUSE_SNAPSHOT_KEY] = snap


def _clear_pause_snapshot(project, reason=""):
    _write_pause_snapshot(project, task_id="", request_id="", content="", active=False)
    snap = project.get(_PAUSE_SNAPSHOT_KEY, {})
    if isinstance(snap, dict):
        snap["reason"] = str(reason or "")
        snap["updated_at"] = _now_text()
        project[_PAUSE_SNAPSHOT_KEY] = snap


def _get_pause_snapshot(project):
    snap = project.get(_PAUSE_SNAPSHOT_KEY, {})
    if not isinstance(snap, dict):
        return None
    if not snap.get("active"):
        return None
    content = str(snap.get("content", "") or "").strip()
    if not content:
        return None
    return snap


def _get_active_generation_checkpoint(project):
    checkpoint = project.get(_GEN_CHECKPOINT_KEY, {})
    if not isinstance(checkpoint, dict):
        return None
    if not checkpoint.get("active"):
        return None
    return checkpoint


def _merge_draft_for_resume(draft_content, resume_seed):
    base = str(draft_content or "")
    seed = str(resume_seed or "").strip()
    if not seed:
        return base
    if seed in base:
        return base
    if not base.strip():
        return seed
    if base.endswith("\n"):
        return f"{base}\n{seed}"
    return f"{base}\n\n{seed}"


def _merge_resume_and_generated(resume_seed, generated_text):
    prefix = str(resume_seed or "").rstrip()
    tail = str(generated_text or "").lstrip()
    if prefix and tail:
        sep = "\n\n" if not prefix.endswith("\n") else "\n"
        return f"{prefix}{sep}{tail}"
    return prefix or tail


def _is_stop_requested(task_id):
    with _generation_lock:
        task = generation_tasks.get(task_id)
        return bool(task and task.get("stop_requested"))


def _run_engine_prewarm():
    try:
        test_engine_connectivity()
    except Exception:
        pass


def _start_background_prewarm(force=False):
    global _prewarm_started
    with _prewarm_lock:
        if _prewarm_started and not force:
            return False
        _prewarm_started = True
    threading.Thread(target=_run_engine_prewarm, daemon=True).start()
    return True


def _force_stop_process(pid=None, proc=None):
    stopped = False
    details = []

    if proc is not None:
        try:
            proc.kill()
            stopped = True
            details.append("proc.kill")
        except Exception as e:
            details.append(f"proc.kill failed: {e}")

    if pid:
        try:
            if os.name == "nt":
                r = subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True,
                    text=True,
                    timeout=8,
                )
                if r.returncode == 0:
                    stopped = True
                    details.append("taskkill /T /F")
                else:
                    out = (r.stdout or "").strip()
                    err = (r.stderr or "").strip()
                    details.append(f"taskkill rc={r.returncode} out={out} err={err}")
            else:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
                stopped = True
                details.append("killpg SIGKILL")
        except Exception as e:
            details.append(f"pid kill failed: {e}")

    return stopped, "; ".join(details)


def _abort_all_generation_tasks():
    with _generation_lock:
        items = list(generation_tasks.items())
    for task_id, task in items:
        if not isinstance(task, dict):
            continue
        state = str(task.get("state", "") or "")
        if state in {"done", "error", "stopped"}:
            continue
        runner_pid = task.get("runner_pid")
        runner_proc = task.get("runner_proc")
        forced, _ = _force_stop_process(pid=runner_pid, proc=runner_proc)
        with _generation_lock:
            current = generation_tasks.get(task_id)
            if not current:
                continue
            current["stop_requested"] = True
            current["state"] = "stopped" if forced else "stopping"
            current["message"] = "因切换书籍已停止"
            current["client_paused"] = False
            generation_tasks[task_id] = current


def _generation_worker(
    task_id,
    request_id,
    outline,
    reference,
    requirements,
    word_target,
    reasoning_effort,
    extra_settings,
    global_memory,
    resume_seed="",
):
    project = load_project()
    draft_so_far = _merge_draft_for_resume(
        project.get("draft", {}).get("content", ""),
        resume_seed,
    )
    last_checkpoint_write = 0.0

    def _flush_checkpoint(partial_text, thinking_text, state="running", force=False):
        nonlocal last_checkpoint_write
        ts = datetime.now().timestamp()
        if (not force) and (ts - last_checkpoint_write < 0.8):
            return
        p = load_project()
        cp = _build_generation_checkpoint(
            task_id=task_id,
            request_id=request_id,
            outline=outline,
            reference=reference,
            requirements=requirements,
            word_target=word_target,
            reasoning_effort=reasoning_effort,
            extra_settings=extra_settings,
            global_memory=global_memory,
            partial_content=partial_text,
            thinking=thinking_text,
            resume_seed=resume_seed,
            state=state,
        )
        old = p.get(_GEN_CHECKPOINT_KEY, {})
        if isinstance(old, dict) and old.get("created_at"):
            cp["created_at"] = old.get("created_at")
        _write_generation_checkpoint(p, cp)
        save_project(p)
        last_checkpoint_write = ts

    def _on_progress(partial_text, thinking_text):
        combined_partial = _merge_resume_and_generated(resume_seed, partial_text)
        with _generation_lock:
            task = generation_tasks.get(task_id)
            if not task or task.get("state") != "running":
                return
            task["partial_content"] = combined_partial
            task["thinking"] = thinking_text
            task["request_id"] = request_id
        _flush_checkpoint(combined_partial, thinking_text, state="running")

    def _on_process_start(proc):
        with _generation_lock:
            task = generation_tasks.get(task_id)
            if not task:
                return
            task["runner_pid"] = getattr(proc, "pid", None)
            task["runner_proc"] = proc

    def _on_process_end(proc):
        with _generation_lock:
            task = generation_tasks.get(task_id)
            if not task:
                return
            if task.get("runner_pid") == getattr(proc, "pid", None):
                task["runner_pid"] = None
                task["runner_proc"] = None

    chapter_count = 0
    try:
        chapter_items = list_chapters()
        if isinstance(chapter_items, list):
            chapter_count = len(chapter_items)
        elif isinstance(chapter_items, dict):
            chapter_count = len(chapter_items.get("chapters", []) or [])
    except Exception:
        chapter_count = 0
    current_chapter = max(1, chapter_count + 1)

    try:
        _log_with_request(request_id, f"generation worker started task_id={task_id}")
        result = generate_novel_with_progress(
            outline,
            reference,
            requirements,
            word_target,
            extra_settings,
            global_memory,
            draft_so_far,
            reasoning_effort=reasoning_effort,
            on_progress=_on_progress,
            should_stop=lambda: _is_stop_requested(task_id),
            on_process_start=_on_process_start,
            on_process_end=_on_process_end,
            request_id=request_id,
            chapter_number=current_chapter,
        )
    except Exception as e:
        with _generation_lock:
            generation_tasks[task_id] = {
                "state": "error",
                "message": f"生成线程异常: {e}",
                "error_code": infer_error_code(str(e)),
                "request_id": request_id,
            }
        _log_with_request(request_id, f"generation worker exception: {e}")
        p = load_project()
        checkpoint = p.get(_GEN_CHECKPOINT_KEY, {})
        if isinstance(checkpoint, dict):
            checkpoint["active"] = True
            checkpoint["state"] = "error"
            checkpoint["message"] = f"生成线程异常: {e}"
            checkpoint["request_id"] = request_id
            checkpoint["updated_at"] = _now_text()
            p[_GEN_CHECKPOINT_KEY] = checkpoint
            save_project(p)
        return

    if _is_stop_requested(task_id):
        with _generation_lock:
            generation_tasks[task_id] = {
                "state": "stopped",
                "message": "已停止生成",
                "error_code": "stopped",
                "request_id": request_id,
            }
        _log_with_request(request_id, f"generation stopped task_id={task_id}")
        p = load_project()
        _clear_generation_checkpoint(p, reason="stopped_by_user")
        _clear_pause_snapshot(p, reason="stopped_by_user")
        save_project(p)
        return

    if result["success"]:
        content = _merge_resume_and_generated(resume_seed, result["content"])
        with _generation_lock:
            generation_tasks[task_id] = {
                "state": "done",
                "content": content,
                "partial_content": content,
                "thinking": THINKING_PHASES[-1][1],
                "request_id": request_id,
            }

        project = load_project()
        project.setdefault("draft", {})
        project["draft"]["last_generated"] = content
        _clear_generation_checkpoint(project, reason="completed")
        _clear_pause_snapshot(project, reason="completed")
        save_project(project)
        _log_with_request(request_id, f"generation done task_id={task_id} chars={len(content)}")
    else:
        if (result.get("error") or "") == "stopped by user":
            with _generation_lock:
                generation_tasks[task_id] = {
                    "state": "stopped",
                    "message": "已停止生成",
                    "error_code": "stopped",
                    "request_id": request_id,
                }
            p = load_project()
            _clear_generation_checkpoint(p, reason="stopped_by_user")
            _clear_pause_snapshot(p, reason="stopped_by_user")
            save_project(p)
            _log_with_request(request_id, f"generation stopped by user task_id={task_id}")
            return
        with _generation_lock:
            generation_tasks[task_id] = {
                "state": "error",
                "message": result.get("error") or "生成失败",
                "error_code": infer_error_code(result.get("error") or "生成失败"),
                "request_id": request_id,
            }
        _log_with_request(request_id, f"generation failed task_id={task_id}: {result.get('error') or '生成失败'}")
        p = load_project()
        checkpoint = p.get(_GEN_CHECKPOINT_KEY, {})
        if isinstance(checkpoint, dict):
            checkpoint["active"] = True
            checkpoint["state"] = "error"
            checkpoint["message"] = result.get("error") or "生成失败"
            checkpoint["request_id"] = request_id
            checkpoint["updated_at"] = _now_text()
            p[_GEN_CHECKPOINT_KEY] = checkpoint
            save_project(p)


def _start_generation_task(
    *,
    request_id="",
    outline,
    reference,
    requirements,
    word_target,
    reasoning_effort,
    extra_settings,
    global_memory,
    resume_seed="",
):
    task_id = uuid.uuid4().hex
    rid = str(request_id or "").strip() or uuid.uuid4().hex[:12]
    with _generation_lock:
        generation_tasks[task_id] = {
            "state": "running",
            "partial_content": "",
            "thinking": THINKING_PHASES[0][1],
            "stop_requested": False,
            "client_paused": False,
            "runner_pid": None,
            "runner_proc": None,
            "request_id": rid,
        }

    t = threading.Thread(
        target=_generation_worker,
        args=(
            task_id,
            rid,
            outline,
            reference,
            requirements,
            word_target,
            reasoning_effort,
            extra_settings,
            global_memory,
            resume_seed,
        ),
        daemon=True,
    )
    t.start()
    return task_id, rid


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def api_get_config():
    ensure_output_dir()
    # Trigger chapter bootstrap from test folder when metadata is empty.
    try:
        list_chapters()
    except Exception:
        pass
    _sync_project_config_with_global_settings(force=False)
    project = load_project()
    config = project.get("config", {})
    shelf = get_bookshelf()
    global_memory_text, global_memory_structured = _normalize_memory_payload(
        config.get("global_memory", ""),
        config.get("global_memory_structured", {}),
    )
    if global_memory_text != str(config.get("global_memory", "") or ""):
        config["global_memory"] = global_memory_text
        config["global_memory_structured"] = global_memory_structured
        project["config"] = config
        save_project(project)
    engine_mode = _text(config.get("engine_mode", "codex")).lower()
    if engine_mode not in {"codex", "gemini", "doubao", "claude", "personal"}:
        engine_mode = "codex"
    codex_access_mode = _access_mode(config.get("codex_access_mode", "cli"))
    gemini_access_mode = _access_mode(config.get("gemini_access_mode", "cli"))
    claude_access_mode = _access_mode(config.get("claude_access_mode", "cli"))
    auth_cfg = _auth_snapshot()
    _apply_runtime_proxy_from_config(config)
    doubao_models = _doubao_models(
        config.get("doubao_models", "") or config.get("doubao_model", _DEFAULT_DOUBAO_MODELS[0])
    )
    personal_models = _personal_models(
        config.get("personal_models", "") or config.get("personal_model", _DEFAULT_PERSONAL_MODEL)
    )
    return jsonify(
        {
            "config_version": _config_version(config.get("config_version", 2)),
            "outline": config.get("outline", ""),
            "reference": config.get("reference", ""),
            "requirements": config.get("requirements", ""),
            "word_target": config.get("word_target", ""),
            "extra_settings": config.get("extra_settings", ""),
            "global_memory": config.get("global_memory", ""),
            "global_memory_structured": config.get("global_memory_structured", {}),
            "engine_mode": engine_mode,
            "codex_model": config.get("codex_model", ""),
            "gemini_model": config.get("gemini_model", ""),
            "claude_model": _claude_model(config.get("claude_model", "sonnet")),
            "codex_access_mode": codex_access_mode,
            "gemini_access_mode": gemini_access_mode,
            "claude_access_mode": claude_access_mode,
            "codex_api_key": auth_cfg.get("OPENAI_API_KEY", ""),
            "gemini_api_key": auth_cfg.get("GEMINI_API_KEY", ""),
            "claude_api_key": auth_cfg.get("ANTHROPIC_API_KEY", ""),
            "codex_reasoning_effort": config.get("codex_reasoning_effort", "medium"),
            "gemini_reasoning_effort": config.get("gemini_reasoning_effort", "medium"),
            "claude_reasoning_effort": config.get("claude_reasoning_effort", "medium"),
            "doubao_reasoning_effort": config.get("doubao_reasoning_effort", "medium"),
            "doubao_models": doubao_models,
            "doubao_model": _doubao_model_mirror(doubao_models, config.get("doubao_model", "")),
            "personal_base_url": auth_cfg.get("PERSONAL_BASE_URL", ""),
            "personal_api_key": auth_cfg.get("PERSONAL_API_KEY", ""),
            "personal_models": personal_models,
            "personal_model": _personal_model_mirror(personal_models, config.get("personal_model", "")),
            "proxy_port": _proxy_port(config.get("proxy_port", "10808")),
            "cache": _read_cache(project),
            "active_book": shelf.get("active_book", {}),
            "books": shelf.get("books", []),
            "book_paths": shelf.get("active_paths", {}),
            "first_run_required": _is_first_run_book_required(project, shelf),
            "settings_path": settings_file_path(),
            "auth_path": auth_file_path(),
        }
    )


@app.route("/api/status", methods=["GET"])
def api_status():
    status = get_codex_status()
    active = get_active_book() or {}
    status["active_book"] = active
    return jsonify(status)


@app.route("/api/engine/test-connectivity", methods=["POST"])
def api_engine_test_connectivity():
    data = request.get_json(silent=True) or {}
    result = test_engine_connectivity(data)
    ok = bool(result.get("ok"))
    return jsonify(result), (200 if ok else 400)


@app.route("/api/engine/prewarm", methods=["POST"])
def api_engine_prewarm():
    started = _start_background_prewarm(force=False)
    return jsonify({"ok": True, "started": bool(started)})


@app.route("/api/background/library", methods=["GET"])
def api_background_library():
    return jsonify({"items": _list_background_items()})


@app.route("/api/background/file/<path:file_name>", methods=["GET"])
def api_background_file(file_name):
    target = _background_safe_path(os.path.basename(str(file_name or "")))
    if not target:
        return jsonify({"ok": False, "message": "背景文件不存在"}), 404
    return send_file(target, conditional=True)


@app.route("/api/self-check", methods=["GET"])
def api_self_check():
    project, _, _ = _sync_project_config_with_global_settings(force=True)
    _apply_runtime_proxy_from_config(project.get("config", {}))
    return jsonify(get_startup_self_check())


@app.route("/api/settings/file", methods=["GET"])
def api_settings_file_get():
    return jsonify(
        {
            "path": settings_file_path(),
            "backup_path": settings_backup_file_path(),
            "content": read_settings_text(),
        }
    )


@app.route("/api/settings/file", methods=["POST"])
def api_settings_file_save():
    data = request.get_json(silent=True) or {}
    content = str(data.get("content", "") or "")
    if not content.strip():
        return jsonify({"ok": False, "message": "settings.json 内容为空"}), 400
    try:
        saved = write_settings_text(content, keep_backup=True)
    except Exception as e:
        return jsonify({"ok": False, "message": f"settings.json 保存失败: {e}"}), 400

    project, _, _ = _sync_project_config_with_global_settings(force=True)
    _apply_runtime_proxy_from_config(project.get("config", {}))
    return jsonify(
        {
            "ok": True,
            "path": settings_file_path(),
            "backup_path": settings_backup_file_path(),
            "settings": saved,
        }
    )


@app.route("/api/settings/file/restore", methods=["POST"])
def api_settings_file_restore():
    restored = restore_settings_backup()
    if not restored:
        return jsonify({"ok": False, "message": "未找到可复原的 settings.prev.json"}), 404
    project, _, _ = _sync_project_config_with_global_settings(force=True)
    _apply_runtime_proxy_from_config(project.get("config", {}))
    return jsonify(
        {
            "ok": True,
            "path": settings_file_path(),
            "backup_path": settings_backup_file_path(),
            "settings": restored,
        }
    )


@app.route("/api/settings/open", methods=["POST"])
def api_settings_open():
    path = settings_file_path()
    try:
        if os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return jsonify({"ok": True, "path": path})
    except Exception as e:
        return jsonify({"ok": False, "message": f"打开 settings.json 失败: {e}", "path": path}), 500


@app.route("/api/auth/file", methods=["GET"])
def api_auth_file_get():
    return jsonify(
        {
            "path": auth_file_path(),
            "backup_path": auth_backup_file_path(),
            "content": read_auth_text(),
        }
    )


@app.route("/api/auth/file", methods=["POST"])
def api_auth_file_save():
    data = request.get_json(silent=True) or {}
    content = str(data.get("content", "") or "")
    if not content.strip():
        return jsonify({"ok": False, "message": "auth.json 内容为空"}), 400
    try:
        saved = write_auth_text(content, keep_backup=True)
    except Exception as e:
        return jsonify({"ok": False, "message": f"auth.json 保存失败: {e}"}), 400
    return jsonify(
        {
            "ok": True,
            "path": auth_file_path(),
            "backup_path": auth_backup_file_path(),
            "auth": saved,
        }
    )


@app.route("/api/auth/file/restore", methods=["POST"])
def api_auth_file_restore():
    restored = restore_auth_backup()
    if not restored:
        return jsonify({"ok": False, "message": "未找到可复原的 auth.prev.json"}), 404
    return jsonify(
        {
            "ok": True,
            "path": auth_file_path(),
            "backup_path": auth_backup_file_path(),
            "auth": restored,
        }
    )


@app.route("/api/auth/open", methods=["POST"])
def api_auth_open():
    path = auth_file_path()
    try:
        if os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return jsonify({"ok": True, "path": path})
    except Exception as e:
        return jsonify({"ok": False, "message": f"打开 auth.json 失败: {e}", "path": path}), 500


@app.route("/api/books", methods=["GET"])
def api_books_get():
    shelf = get_bookshelf()
    return jsonify({"ok": True, **shelf})


@app.route("/api/books", methods=["POST"])
def api_books_create():
    data = request.get_json(silent=True) or {}
    title = _text(data.get("title"))
    if not title:
        return jsonify({"ok": False, "message": "书名不能为空"}), 400
    current_project = load_project()
    current_cfg = current_project.get("config", {}) if isinstance(current_project.get("config"), dict) else {}
    book, paths = create_book(title, set_active=True)
    project_after = load_project()
    cfg_after = project_after.setdefault("config", {})
    if isinstance(cfg_after, dict) and _copy_model_config_fields(current_cfg, cfg_after):
        project_after["config"] = cfg_after
        save_project(project_after)
    _abort_all_generation_tasks()
    return jsonify({"ok": True, "book": book, "paths": paths, "shelf": get_bookshelf()})


@app.route("/api/books/switch", methods=["POST"])
def api_books_switch():
    data = request.get_json(silent=True) or {}
    book_id = _text(data.get("book_id"))
    if not book_id:
        return jsonify({"ok": False, "message": "book_id 不能为空"}), 400
    current_project = load_project()
    current_cfg = current_project.get("config", {}) if isinstance(current_project.get("config"), dict) else {}
    switched = switch_book(book_id)
    if not switched:
        return jsonify({"ok": False, "message": "书籍不存在"}), 404
    project_after = load_project()
    cfg_after = project_after.setdefault("config", {})
    if isinstance(cfg_after, dict) and _copy_model_config_fields(current_cfg, cfg_after):
        project_after["config"] = cfg_after
        save_project(project_after)
    _abort_all_generation_tasks()
    return jsonify({"ok": True, **switched, "shelf": get_bookshelf()})


@app.route("/api/books/delete", methods=["POST"])
def api_books_delete():
    data = request.get_json(silent=True) or {}
    book_id = _text(data.get("book_id"))
    if not book_id:
        return jsonify({"ok": False, "message": "book_id 不能为空"}), 400
    deleted = delete_book(book_id)
    if not deleted:
        return jsonify({"ok": False, "message": "书籍不存在或无法删除"}), 400
    _abort_all_generation_tasks()
    return jsonify({"ok": True, "deleted_id": book_id, "shelf": get_bookshelf()})


@app.route("/api/config", methods=["POST"])
def api_save_config():
    data = request.get_json(silent=True) or {}
    _sync_auth_from_payload(data)
    outline = _text(data.get("outline"))
    reference = _text(data.get("reference"))
    requirements = _text(data.get("requirements"))
    word_target = _text(data.get("word_target"))
    extra_settings = _text(data.get("extra_settings"))
    global_memory = _text(data.get("global_memory"))
    engine_mode = _text(data.get("engine_mode")).lower()
    if engine_mode not in {"codex", "gemini", "doubao", "claude", "personal"}:
        engine_mode = "codex"
    codex_model = _text(data.get("codex_model"))
    gemini_model = _text(data.get("gemini_model"))
    claude_model = _claude_model(data.get("claude_model"))
    codex_access_mode = _access_mode(data.get("codex_access_mode"))
    gemini_access_mode = _access_mode(data.get("gemini_access_mode"))
    claude_access_mode = _access_mode(data.get("claude_access_mode"))
    codex_reasoning_effort = _effort(data.get("codex_reasoning_effort"))
    gemini_reasoning_effort = _effort(data.get("gemini_reasoning_effort"))
    claude_reasoning_effort = _effort(data.get("claude_reasoning_effort"))
    doubao_reasoning_effort = _effort(data.get("doubao_reasoning_effort"))
    doubao_models = _doubao_models(data.get("doubao_models") or data.get("doubao_model"))
    doubao_model = _doubao_model_mirror(doubao_models, data.get("doubao_model"))
    personal_models = _personal_models(data.get("personal_models") or data.get("personal_model"))
    personal_model = _personal_model_mirror(personal_models, data.get("personal_model"))
    proxy_port = _proxy_port(data.get("proxy_port"))

    project = load_project()
    prev_cfg = project.get("config", {})
    normalized_memory_text, normalized_memory_structured = _normalize_memory_payload(
        global_memory,
        prev_cfg.get("global_memory_structured", {}),
    )
    project["config"] = {
        "config_version": _config_version(prev_cfg.get("config_version", 2)),
        "outline": outline,
        "reference": reference,
        "requirements": requirements,
        "word_target": word_target,
        "extra_settings": extra_settings,
        "global_memory": normalized_memory_text,
        "global_memory_structured": normalized_memory_structured,
        "engine_mode": engine_mode,
        "codex_model": codex_model,
        "gemini_model": gemini_model,
        "claude_model": claude_model,
        "codex_access_mode": codex_access_mode,
        "gemini_access_mode": gemini_access_mode,
        "claude_access_mode": claude_access_mode,
        "codex_reasoning_effort": codex_reasoning_effort,
        "gemini_reasoning_effort": gemini_reasoning_effort,
        "claude_reasoning_effort": claude_reasoning_effort,
        "doubao_reasoning_effort": doubao_reasoning_effort,
        "doubao_models": doubao_models,
        "doubao_model": doubao_model,
        "personal_models": personal_models,
        "personal_model": personal_model,
        "proxy_port": proxy_port,
    }
    save_project(project)
    _apply_runtime_proxy_env(proxy_port)
    return jsonify(project["config"])


@app.route("/api/config/proxy", methods=["POST"])
def api_save_proxy_port():
    data = request.get_json(silent=True) or {}
    proxy_port = _proxy_port(data.get("proxy_port"))
    applied_port, proxy_url = _sync_proxy_port_everywhere(proxy_port)
    return jsonify({"ok": True, "proxy_port": applied_port, "proxy_url": proxy_url})


@app.route("/api/outline/generate", methods=["POST"])
def api_generate_outline():
    data = request.get_json(silent=True) or {}
    _sync_auth_from_payload(data)
    outline = _text(data.get("outline"))
    reference = _text(data.get("reference"))
    requirements = _text(data.get("requirements"))
    word_target = _text(data.get("word_target"))
    extra_settings = _text(data.get("extra_settings"))
    global_memory = _text(data.get("global_memory"))
    engine_mode = _text(data.get("engine_mode")).lower()
    if engine_mode not in {"codex", "gemini", "doubao", "claude", "personal"}:
        engine_mode = "codex"

    project = load_project()
    prev_cfg = project.get("config", {})
    codex_model = _text(data.get("codex_model")) or _text(prev_cfg.get("codex_model"))
    gemini_model = _text(data.get("gemini_model")) or _text(prev_cfg.get("gemini_model"))
    claude_model = _claude_model(_text(data.get("claude_model")) or _text(prev_cfg.get("claude_model")))
    codex_access_mode = _access_mode(_text(data.get("codex_access_mode")) or _text(prev_cfg.get("codex_access_mode")))
    gemini_access_mode = _access_mode(_text(data.get("gemini_access_mode")) or _text(prev_cfg.get("gemini_access_mode")))
    claude_access_mode = _access_mode(_text(data.get("claude_access_mode")) or _text(prev_cfg.get("claude_access_mode")))
    preferred_doubao_model = _text(data.get("doubao_model")) or _text(prev_cfg.get("doubao_model"))
    doubao_models = _doubao_models(
        _text(data.get("doubao_models"))
        or preferred_doubao_model
        or _text(prev_cfg.get("doubao_models"))
        or _text(prev_cfg.get("doubao_model"))
    )
    doubao_model = _doubao_model_mirror(doubao_models, preferred_doubao_model)
    personal_models = _personal_models(
        _text(data.get("personal_models")) or _text(prev_cfg.get("personal_models")) or _text(prev_cfg.get("personal_model"))
    )
    preferred_personal_model = _text(data.get("personal_model")) or _text(prev_cfg.get("personal_model"))
    personal_model = _personal_model_mirror(personal_models, preferred_personal_model)
    codex_reasoning_effort = _effort(
        _text(data.get("codex_reasoning_effort")) or _text(prev_cfg.get("codex_reasoning_effort"))
    )
    gemini_reasoning_effort = _effort(
        _text(data.get("gemini_reasoning_effort")) or _text(prev_cfg.get("gemini_reasoning_effort"))
    )
    claude_reasoning_effort = _effort(
        _text(data.get("claude_reasoning_effort")) or _text(prev_cfg.get("claude_reasoning_effort"))
    )
    doubao_reasoning_effort = _effort(
        _text(data.get("doubao_reasoning_effort")) or _text(prev_cfg.get("doubao_reasoning_effort"))
    )
    request_reasoning_effort = _selected_effort_for_mode(
        engine_mode,
        codex_reasoning_effort=codex_reasoning_effort,
        gemini_reasoning_effort=gemini_reasoning_effort,
        claude_reasoning_effort=claude_reasoning_effort,
        doubao_reasoning_effort=doubao_reasoning_effort,
    )
    proxy_port = _proxy_port(_text(data.get("proxy_port")) or _text(prev_cfg.get("proxy_port")))

    normalized_memory_text, normalized_memory_structured = _normalize_memory_payload(
        global_memory,
        prev_cfg.get("global_memory_structured", {}),
    )
    project["config"] = {
        "config_version": _config_version(prev_cfg.get("config_version", 2)),
        "outline": outline,
        "reference": reference,
        "requirements": requirements,
        "word_target": word_target,
        "extra_settings": extra_settings,
        "global_memory": normalized_memory_text,
        "global_memory_structured": normalized_memory_structured,
        "engine_mode": engine_mode,
        "codex_model": codex_model,
        "gemini_model": gemini_model,
        "claude_model": claude_model,
        "codex_access_mode": codex_access_mode,
        "gemini_access_mode": gemini_access_mode,
        "claude_access_mode": claude_access_mode,
        "doubao_models": doubao_models,
        "doubao_model": doubao_model,
        "codex_reasoning_effort": codex_reasoning_effort,
        "gemini_reasoning_effort": gemini_reasoning_effort,
        "claude_reasoning_effort": claude_reasoning_effort,
        "doubao_reasoning_effort": doubao_reasoning_effort,
        "proxy_port": proxy_port,
        "personal_models": personal_models,
        "personal_model": personal_model,
    }
    save_project(project)
    _apply_runtime_proxy_env(proxy_port)

    result = generate_outline(
        outline,
        reference,
        requirements,
        word_target,
        extra_settings,
        normalized_memory_text,
        reasoning_effort=request_reasoning_effort,
    )
    if not result.get("success"):
        return jsonify({"ok": False, "message": result.get("error") or "大纲生成失败"}), 400

    new_outline = _text(result.get("outline"))
    project = load_project()
    cfg = project.setdefault("config", {})
    cfg["outline"] = new_outline
    save_project(project)
    return jsonify({"ok": True, "outline": new_outline})


@app.route("/api/draft/polish", methods=["POST"])
def api_polish_draft():
    data = request.get_json(silent=True) or {}
    _sync_auth_from_payload(data)
    draft_content = _text(data.get("content"))
    if not draft_content:
        return jsonify({"ok": False, "message": "草稿内容为空，无法润色"}), 400

    polish_requirements = _text(data.get("polish_requirements"))
    outline = _text(data.get("outline"))
    reference = _text(data.get("reference"))
    requirements = _text(data.get("requirements"))
    word_target = _text(data.get("word_target"))
    extra_settings = _text(data.get("extra_settings"))
    global_memory = _text(data.get("global_memory"))
    engine_mode = _text(data.get("engine_mode")).lower()
    if engine_mode not in {"codex", "gemini", "doubao", "claude", "personal"}:
        engine_mode = "codex"

    project = load_project()
    prev_cfg = project.get("config", {})
    codex_model = _text(data.get("codex_model")) or _text(prev_cfg.get("codex_model"))
    gemini_model = _text(data.get("gemini_model")) or _text(prev_cfg.get("gemini_model"))
    claude_model = _claude_model(_text(data.get("claude_model")) or _text(prev_cfg.get("claude_model")))
    codex_access_mode = _access_mode(_text(data.get("codex_access_mode")) or _text(prev_cfg.get("codex_access_mode")))
    gemini_access_mode = _access_mode(_text(data.get("gemini_access_mode")) or _text(prev_cfg.get("gemini_access_mode")))
    claude_access_mode = _access_mode(_text(data.get("claude_access_mode")) or _text(prev_cfg.get("claude_access_mode")))
    codex_reasoning_effort = _effort(
        _text(data.get("codex_reasoning_effort")) or _text(prev_cfg.get("codex_reasoning_effort"))
    )
    gemini_reasoning_effort = _effort(
        _text(data.get("gemini_reasoning_effort")) or _text(prev_cfg.get("gemini_reasoning_effort"))
    )
    claude_reasoning_effort = _effort(
        _text(data.get("claude_reasoning_effort")) or _text(prev_cfg.get("claude_reasoning_effort"))
    )
    doubao_reasoning_effort = _effort(
        _text(data.get("doubao_reasoning_effort")) or _text(prev_cfg.get("doubao_reasoning_effort"))
    )
    request_reasoning_effort = _selected_effort_for_mode(
        engine_mode,
        codex_reasoning_effort=codex_reasoning_effort,
        gemini_reasoning_effort=gemini_reasoning_effort,
        claude_reasoning_effort=claude_reasoning_effort,
        doubao_reasoning_effort=doubao_reasoning_effort,
    )
    preferred_doubao_model = _text(data.get("doubao_model")) or _text(prev_cfg.get("doubao_model"))
    doubao_models = _doubao_models(
        _text(data.get("doubao_models"))
        or preferred_doubao_model
        or _text(prev_cfg.get("doubao_models"))
        or _text(prev_cfg.get("doubao_model"))
    )
    doubao_model = _doubao_model_mirror(doubao_models, preferred_doubao_model)
    personal_models = _personal_models(
        _text(data.get("personal_models")) or _text(prev_cfg.get("personal_models")) or _text(prev_cfg.get("personal_model"))
    )
    preferred_personal_model = _text(data.get("personal_model")) or _text(prev_cfg.get("personal_model"))
    personal_model = _personal_model_mirror(personal_models, preferred_personal_model)
    proxy_port = _proxy_port(_text(data.get("proxy_port")) or _text(prev_cfg.get("proxy_port")))

    normalized_memory_text, normalized_memory_structured = _normalize_memory_payload(
        global_memory,
        prev_cfg.get("global_memory_structured", {}),
    )
    project["config"] = {
        "config_version": _config_version(prev_cfg.get("config_version", 2)),
        "outline": outline or _text(prev_cfg.get("outline")),
        "reference": reference or _text(prev_cfg.get("reference")),
        "requirements": requirements or _text(prev_cfg.get("requirements")),
        "word_target": word_target or _text(prev_cfg.get("word_target")),
        "extra_settings": extra_settings or _text(prev_cfg.get("extra_settings")),
        "global_memory": normalized_memory_text,
        "global_memory_structured": normalized_memory_structured,
        "engine_mode": engine_mode,
        "codex_model": codex_model,
        "gemini_model": gemini_model,
        "claude_model": claude_model,
        "codex_access_mode": codex_access_mode,
        "gemini_access_mode": gemini_access_mode,
        "claude_access_mode": claude_access_mode,
        "codex_reasoning_effort": codex_reasoning_effort,
        "gemini_reasoning_effort": gemini_reasoning_effort,
        "claude_reasoning_effort": claude_reasoning_effort,
        "doubao_reasoning_effort": doubao_reasoning_effort,
        "doubao_models": doubao_models,
        "doubao_model": doubao_model,
        "personal_models": personal_models,
        "personal_model": personal_model,
        "proxy_port": proxy_port,
    }
    save_project(project)
    _apply_runtime_proxy_env(proxy_port)

    result = polish_draft(
        draft_content=draft_content,
        polish_requirements=polish_requirements,
        reference=project["config"].get("reference", ""),
        requirements=project["config"].get("requirements", ""),
        word_target=project["config"].get("word_target", ""),
        extra_settings=project["config"].get("extra_settings", ""),
        global_memory=project["config"].get("global_memory", ""),
        reasoning_effort=request_reasoning_effort,
    )
    if not result.get("success"):
        return jsonify({"ok": False, "message": result.get("error") or "润色失败"}), 400

    return jsonify(
        {
            "ok": True,
            "content": _text(result.get("content")),
            "engine_mode": engine_mode,
            "model": (
                doubao_model if engine_mode == "doubao"
                else personal_model if engine_mode == "personal"
                else gemini_model if engine_mode == "gemini"
                else claude_model if engine_mode == "claude"
                else codex_model
            ),
        }
    )


@app.route("/api/reference/optimize", methods=["POST"])
def api_optimize_reference():
    data = request.get_json(silent=True) or {}
    _sync_auth_from_payload(data)
    reference = _text(data.get("reference"))
    if not reference:
        return jsonify({"ok": False, "message": "参考文本为空，无法总结"}), 400

    engine_mode = _text(data.get("engine_mode")).lower()
    if engine_mode not in {"codex", "gemini", "doubao", "claude", "personal"}:
        engine_mode = "codex"

    project = load_project()
    prev_cfg = project.get("config", {}) if isinstance(project.get("config"), dict) else {}
    codex_model = _text(data.get("codex_model")) or _text(prev_cfg.get("codex_model"))
    gemini_model = _text(data.get("gemini_model")) or _text(prev_cfg.get("gemini_model"))
    claude_model = _claude_model(_text(data.get("claude_model")) or _text(prev_cfg.get("claude_model")))
    codex_access_mode = _access_mode(_text(data.get("codex_access_mode")) or _text(prev_cfg.get("codex_access_mode")))
    gemini_access_mode = _access_mode(_text(data.get("gemini_access_mode")) or _text(prev_cfg.get("gemini_access_mode")))
    claude_access_mode = _access_mode(_text(data.get("claude_access_mode")) or _text(prev_cfg.get("claude_access_mode")))
    codex_reasoning_effort = _effort(
        _text(data.get("codex_reasoning_effort")) or _text(prev_cfg.get("codex_reasoning_effort"))
    )
    gemini_reasoning_effort = _effort(
        _text(data.get("gemini_reasoning_effort")) or _text(prev_cfg.get("gemini_reasoning_effort"))
    )
    claude_reasoning_effort = _effort(
        _text(data.get("claude_reasoning_effort")) or _text(prev_cfg.get("claude_reasoning_effort"))
    )
    doubao_reasoning_effort = _effort(
        _text(data.get("doubao_reasoning_effort")) or _text(prev_cfg.get("doubao_reasoning_effort"))
    )
    request_reasoning_effort = _selected_effort_for_mode(
        engine_mode,
        codex_reasoning_effort=codex_reasoning_effort,
        gemini_reasoning_effort=gemini_reasoning_effort,
        claude_reasoning_effort=claude_reasoning_effort,
        doubao_reasoning_effort=doubao_reasoning_effort,
    )
    preferred_doubao_model = _text(data.get("doubao_model")) or _text(prev_cfg.get("doubao_model"))
    doubao_models = _doubao_models(
        _text(data.get("doubao_models"))
        or preferred_doubao_model
        or _text(prev_cfg.get("doubao_models"))
        or _text(prev_cfg.get("doubao_model"))
    )
    doubao_model = _doubao_model_mirror(doubao_models, preferred_doubao_model)
    personal_models = _personal_models(
        _text(data.get("personal_models")) or _text(prev_cfg.get("personal_models")) or _text(prev_cfg.get("personal_model"))
    )
    preferred_personal_model = _text(data.get("personal_model")) or _text(prev_cfg.get("personal_model"))
    personal_model = _personal_model_mirror(personal_models, preferred_personal_model)
    proxy_port = _proxy_port(_text(data.get("proxy_port")) or _text(prev_cfg.get("proxy_port")))

    normalized_memory_text = _text(prev_cfg.get("global_memory"))
    normalized_memory_structured = prev_cfg.get("global_memory_structured", {})
    if not isinstance(normalized_memory_structured, dict):
        normalized_memory_structured = {}

    project["config"] = {
        "config_version": _config_version(prev_cfg.get("config_version", 2)),
        "outline": _text(prev_cfg.get("outline")),
        "reference": reference,
        "requirements": _text(prev_cfg.get("requirements")),
        "word_target": _text(prev_cfg.get("word_target")),
        "extra_settings": _text(prev_cfg.get("extra_settings")),
        "global_memory": normalized_memory_text,
        "global_memory_structured": normalized_memory_structured,
        "engine_mode": engine_mode,
        "codex_model": codex_model,
        "gemini_model": gemini_model,
        "claude_model": claude_model,
        "codex_access_mode": codex_access_mode,
        "gemini_access_mode": gemini_access_mode,
        "claude_access_mode": claude_access_mode,
        "codex_reasoning_effort": codex_reasoning_effort,
        "gemini_reasoning_effort": gemini_reasoning_effort,
        "claude_reasoning_effort": claude_reasoning_effort,
        "doubao_reasoning_effort": doubao_reasoning_effort,
        "doubao_models": doubao_models,
        "doubao_model": doubao_model,
        "personal_models": personal_models,
        "personal_model": personal_model,
        "proxy_port": proxy_port,
    }
    save_project(project)
    _apply_runtime_proxy_env(proxy_port)

    result = optimize_reference_prompt(
        reference=reference,
        reasoning_effort=request_reasoning_effort,
    )
    if not result.get("success"):
        return jsonify({"ok": False, "message": result.get("error") or "参考文本总结失败"}), 400

    optimized_reference = _text(result.get("reference"))
    project = load_project()
    cfg = project.setdefault("config", {})
    cfg["reference"] = optimized_reference
    save_project(project)

    return jsonify(
        {
            "ok": True,
            "reference": optimized_reference,
            "engine_mode": engine_mode,
            "model": (
                doubao_model if engine_mode == "doubao"
                else personal_model if engine_mode == "personal"
                else gemini_model if engine_mode == "gemini"
                else claude_model if engine_mode == "claude"
                else codex_model
            ),
        }
    )


@app.route("/api/generate", methods=["POST"])
def api_generate():
    data = request.get_json(silent=True) or {}
    _sync_auth_from_payload(data)
    outline = _text(data.get("outline"))
    reference = _text(data.get("reference"))
    requirements = _text(data.get("requirements"))
    word_target = _text(data.get("word_target"))
    extra_settings = _text(data.get("extra_settings"))
    global_memory = _text(data.get("global_memory"))
    engine_mode = _text(data.get("engine_mode")).lower()
    if engine_mode not in {"codex", "gemini", "doubao", "claude", "personal"}:
        engine_mode = "codex"
    project = load_project()
    prev_cfg = project.get("config", {})
    codex_model = _text(data.get("codex_model")) or _text(prev_cfg.get("codex_model"))
    gemini_model = _text(data.get("gemini_model")) or _text(prev_cfg.get("gemini_model"))
    claude_model = _claude_model(_text(data.get("claude_model")) or _text(prev_cfg.get("claude_model")))
    codex_access_mode = _access_mode(_text(data.get("codex_access_mode")) or _text(prev_cfg.get("codex_access_mode")))
    gemini_access_mode = _access_mode(_text(data.get("gemini_access_mode")) or _text(prev_cfg.get("gemini_access_mode")))
    claude_access_mode = _access_mode(_text(data.get("claude_access_mode")) or _text(prev_cfg.get("claude_access_mode")))
    codex_reasoning_effort = _effort(
        _text(data.get("codex_reasoning_effort")) or _text(prev_cfg.get("codex_reasoning_effort"))
    )
    gemini_reasoning_effort = _effort(
        _text(data.get("gemini_reasoning_effort")) or _text(prev_cfg.get("gemini_reasoning_effort"))
    )
    claude_reasoning_effort = _effort(
        _text(data.get("claude_reasoning_effort")) or _text(prev_cfg.get("claude_reasoning_effort"))
    )
    doubao_reasoning_effort = _effort(
        _text(data.get("doubao_reasoning_effort")) or _text(prev_cfg.get("doubao_reasoning_effort"))
    )
    request_reasoning_effort = _selected_effort_for_mode(
        engine_mode,
        codex_reasoning_effort=codex_reasoning_effort,
        gemini_reasoning_effort=gemini_reasoning_effort,
        claude_reasoning_effort=claude_reasoning_effort,
        doubao_reasoning_effort=doubao_reasoning_effort,
    )
    preferred_doubao_model = _text(data.get("doubao_model")) or _text(prev_cfg.get("doubao_model"))
    doubao_models = _doubao_models(
        _text(data.get("doubao_models"))
        or preferred_doubao_model
        or _text(prev_cfg.get("doubao_models"))
        or _text(prev_cfg.get("doubao_model"))
    )
    doubao_model = _doubao_model_mirror(doubao_models, preferred_doubao_model)
    personal_models = _personal_models(
        _text(data.get("personal_models")) or _text(prev_cfg.get("personal_models")) or _text(prev_cfg.get("personal_model"))
    )
    preferred_personal_model = _text(data.get("personal_model")) or _text(prev_cfg.get("personal_model"))
    personal_model = _personal_model_mirror(personal_models, preferred_personal_model)
    proxy_port = _proxy_port(_text(data.get("proxy_port")) or _text(prev_cfg.get("proxy_port")))

    normalized_memory_text, normalized_memory_structured = _normalize_memory_payload(
        global_memory,
        prev_cfg.get("global_memory_structured", {}),
    )
    project["config"] = {
        "config_version": _config_version(prev_cfg.get("config_version", 2)),
        "outline": outline,
        "reference": reference,
        "requirements": requirements,
        "word_target": word_target,
        "extra_settings": extra_settings,
        "global_memory": normalized_memory_text,
        "global_memory_structured": normalized_memory_structured,
        "engine_mode": engine_mode,
        "codex_model": codex_model,
        "gemini_model": gemini_model,
        "claude_model": claude_model,
        "codex_access_mode": codex_access_mode,
        "gemini_access_mode": gemini_access_mode,
        "claude_access_mode": claude_access_mode,
        "codex_reasoning_effort": codex_reasoning_effort,
        "gemini_reasoning_effort": gemini_reasoning_effort,
        "claude_reasoning_effort": claude_reasoning_effort,
        "doubao_reasoning_effort": doubao_reasoning_effort,
        "doubao_models": doubao_models,
        "doubao_model": doubao_model,
        "personal_models": personal_models,
        "personal_model": personal_model,
        "proxy_port": proxy_port,
    }

    request_id = uuid.uuid4().hex[:12]
    checkpoint = _build_generation_checkpoint(
        task_id="",
        request_id=request_id,
        outline=outline,
        reference=reference,
        requirements=requirements,
        word_target=word_target,
        reasoning_effort=request_reasoning_effort,
        extra_settings=extra_settings,
        global_memory=normalized_memory_text,
        partial_content="",
        thinking=THINKING_PHASES[0][1],
        resume_seed="",
        state="running",
    )
    _write_generation_checkpoint(project, checkpoint)
    _clear_pause_snapshot(project, reason="new_generation")
    save_project(project)
    _apply_runtime_proxy_env(proxy_port)
    task_id, request_id = _start_generation_task(
        request_id=request_id,
        outline=outline,
        reference=reference,
        requirements=requirements,
        word_target=word_target,
        reasoning_effort=request_reasoning_effort,
        extra_settings=extra_settings,
        global_memory=normalized_memory_text,
        resume_seed="",
    )

    project = load_project()
    cp = project.get(_GEN_CHECKPOINT_KEY, {})
    if isinstance(cp, dict):
        cp["task_id"] = task_id
        cp["request_id"] = request_id
        cp["updated_at"] = _now_text()
        project[_GEN_CHECKPOINT_KEY] = cp
        save_project(project)

    _log_with_request(request_id, f"generation requested task_id={task_id}")
    return jsonify({"task_id": task_id, "request_id": request_id})


@app.route("/api/generate/status/<task_id>", methods=["GET"])
def api_generate_status(task_id):
    with _generation_lock:
        task = generation_tasks.get(task_id)

    if not task:
        return jsonify({"state": "error", "message": "task not found", "error_code": "unknown", "request_id": ""}), 404

    state = task.get("state")
    request_id = str(task.get("request_id", "") or "")
    if state == "done":
        return jsonify(
            {
                "state": "done",
                "content": task.get("content", ""),
                "typewriter": True,
                "request_id": request_id,
            }
        )
    if state == "stopped":
        return jsonify({"state": "stopped", "message": task.get("message", "已停止生成"), "error_code": "stopped", "request_id": request_id})
    if state == "error":
        message = task.get("message", "生成失败")
        return jsonify(
            {
                "state": "error",
                "message": message,
                "error_code": task.get("error_code") or infer_error_code(message),
                "request_id": request_id,
            }
        )
    if state == "stopping":
        return jsonify(
            {
                "state": "stopping",
                "partial_content": task.get("partial_content", ""),
                "thinking": task.get("thinking", "正在停止..."),
                "request_id": request_id,
            }
        )
    if bool(task.get("client_paused", False)):
        return jsonify(
            {
                "state": "paused",
                "partial_content": task.get("partial_content", ""),
                "thinking": "已暂停",
                "request_id": request_id,
            }
        )
    return jsonify(
        {
            "state": "running",
            "partial_content": task.get("partial_content", ""),
            "thinking": task.get("thinking", THINKING_PHASES[0][1]),
            "request_id": request_id,
        }
    )


@app.route("/api/generate/pause/<task_id>", methods=["POST"])
def api_generate_pause(task_id):
    data = request.get_json(silent=True) or {}
    paused = bool(data.get("paused", True))
    with _generation_lock:
        task = generation_tasks.get(task_id)
        if not task:
            return jsonify({"ok": False, "message": "task not found"}), 404
        state = str(task.get("state", "") or "")
        if state not in {"running", "stopping"}:
            return jsonify({"ok": False, "message": "task not running", "state": state}), 400
        task["client_paused"] = paused
        if paused:
            task["thinking"] = "已暂停"
        elif str(task.get("thinking", "") or "").startswith("已暂停"):
            task["thinking"] = THINKING_PHASES[1][1]
        generation_tasks[task_id] = task
        request_id = str(task.get("request_id", "") or "")
    return jsonify({"ok": True, "paused": paused, "state": state, "request_id": request_id})


@app.route("/api/generate/recovery", methods=["GET"])
def api_generate_recovery():
    project = load_project()
    checkpoint = _get_active_generation_checkpoint(project)
    pause_snapshot = _get_pause_snapshot(project)
    if not checkpoint and not pause_snapshot:
        return jsonify({"recoverable": False})

    partial = str((checkpoint or {}).get("partial_content", "") or "")
    task_id = str((checkpoint or {}).get("task_id", "") or "")
    request_id = str((checkpoint or {}).get("request_id", "") or "")
    live_task = False
    live_state = ""
    if task_id:
        with _generation_lock:
            task = generation_tasks.get(task_id)
        if isinstance(task, dict):
            live_state = str(task.get("state", "") or "")
            live_task = live_state in {"running", "stopping"}
            if not partial:
                partial = str(task.get("partial_content", "") or "")
            if not request_id:
                request_id = str(task.get("request_id", "") or "")

    source = "checkpoint" if checkpoint else ""
    if pause_snapshot and not partial.strip():
        partial = str(pause_snapshot.get("content", "") or "")
        if not request_id:
            request_id = str(pause_snapshot.get("request_id", "") or "")
        if not task_id:
            task_id = str(pause_snapshot.get("task_id", "") or "")
        source = "pause_snapshot"
    return jsonify(
        {
            "recoverable": True,
            "task_id": task_id,
            "request_id": request_id,
            "partial_content": partial,
            "thinking": str((checkpoint or {}).get("thinking", "") or THINKING_PHASES[0][1]),
            "updated_at": str((checkpoint or pause_snapshot or {}).get("updated_at", "") or ""),
            "has_partial": bool(partial.strip()),
            "live_task": live_task,
            "live_state": live_state,
            "source": source,
        }
    )


@app.route("/api/generate/pause-snapshot", methods=["POST"])
def api_generate_pause_snapshot():
    data = request.get_json(silent=True) or {}
    task_id = str(data.get("task_id", "") or "")
    content = str(data.get("content", "") or "")
    request_id = str(data.get("request_id", "") or "")
    if not content.strip():
        return jsonify({"ok": False, "message": "empty content"}), 400

    if task_id:
        with _generation_lock:
            task = generation_tasks.get(task_id)
        if isinstance(task, dict):
            if not request_id:
                request_id = str(task.get("request_id", "") or "")

    project = load_project()
    _write_pause_snapshot(
        project,
        task_id=task_id,
        request_id=request_id,
        content=content,
        active=True,
    )
    save_project(project)
    return jsonify({"ok": True, "task_id": task_id, "request_id": request_id, "saved_chars": len(content)})


@app.route("/api/generate/resume", methods=["POST"])
def api_generate_resume():
    project = load_project()
    checkpoint = _get_active_generation_checkpoint(project)
    pause_snapshot = _get_pause_snapshot(project)
    if not checkpoint and not pause_snapshot:
        return jsonify({"ok": False, "message": "no recoverable task"}), 400

    checkpoint = checkpoint or {}
    outline = str(checkpoint.get("outline", "") or "")
    reference = str(checkpoint.get("reference", "") or "")
    requirements = str(checkpoint.get("requirements", "") or "")
    word_target = str(checkpoint.get("word_target", "") or "")
    reasoning_effort = str(checkpoint.get("reasoning_effort", "") or "")
    extra_settings = str(checkpoint.get("extra_settings", "") or "")
    global_memory = str(checkpoint.get("global_memory", "") or "")
    resume_seed = str(
        checkpoint.get("partial_content", "")
        or checkpoint.get("resume_seed", "")
        or ((pause_snapshot or {}).get("content", "") or "")
    )
    if not any([outline, reference, requirements, extra_settings, global_memory]):
        cfg = project.get("config", {}) if isinstance(project.get("config"), dict) else {}
        outline = str(cfg.get("outline", "") or "")
        reference = str(cfg.get("reference", "") or "")
        requirements = str(cfg.get("requirements", "") or "")
        word_target = str(cfg.get("word_target", "") or "")
        extra_settings = str(cfg.get("extra_settings", "") or "")
        global_memory = str(cfg.get("global_memory", "") or "")
        reasoning_effort = _selected_effort_for_mode(
            cfg.get("engine_mode", "codex"),
            codex_reasoning_effort=cfg.get("codex_reasoning_effort", "medium"),
            gemini_reasoning_effort=cfg.get("gemini_reasoning_effort", "medium"),
            claude_reasoning_effort=cfg.get("claude_reasoning_effort", "medium"),
            doubao_reasoning_effort=cfg.get("doubao_reasoning_effort", "medium"),
        )
    elif not _text(reasoning_effort):
        cfg = project.get("config", {}) if isinstance(project.get("config"), dict) else {}
        reasoning_effort = _selected_effort_for_mode(
            cfg.get("engine_mode", "codex"),
            codex_reasoning_effort=cfg.get("codex_reasoning_effort", "medium"),
            gemini_reasoning_effort=cfg.get("gemini_reasoning_effort", "medium"),
            claude_reasoning_effort=cfg.get("claude_reasoning_effort", "medium"),
            doubao_reasoning_effort=cfg.get("doubao_reasoning_effort", "medium"),
        )

    request_id = str(
        checkpoint.get("request_id", "")
        or ((pause_snapshot or {}).get("request_id", ""))
        or uuid.uuid4().hex[:12]
    )
    task_id, request_id = _start_generation_task(
        request_id=request_id,
        outline=outline,
        reference=reference,
        requirements=requirements,
        word_target=word_target,
        reasoning_effort=_effort(reasoning_effort),
        extra_settings=extra_settings,
        global_memory=global_memory,
        resume_seed=resume_seed,
    )

    checkpoint["active"] = True
    checkpoint["state"] = "running"
    checkpoint["task_id"] = task_id
    checkpoint["request_id"] = request_id
    checkpoint["word_target"] = word_target
    checkpoint["reasoning_effort"] = _effort(reasoning_effort)
    checkpoint["resume_seed"] = resume_seed
    checkpoint["updated_at"] = _now_text()
    checkpoint["resumed_at"] = _now_text()
    checkpoint["resume_count"] = int(checkpoint.get("resume_count", 0)) + 1
    project[_GEN_CHECKPOINT_KEY] = checkpoint
    _write_pause_snapshot(
        project,
        task_id=task_id,
        request_id=request_id,
        content=resume_seed,
        active=bool(resume_seed.strip()),
    )
    save_project(project)

    return jsonify(
        {
            "ok": True,
            "task_id": task_id,
            "request_id": request_id,
            "recovered_chars": len(resume_seed),
        }
    )


@app.route("/api/generate/stop/<task_id>", methods=["POST"])
def api_generate_stop(task_id):
    runner_pid = None
    runner_proc = None
    request_id = ""
    with _generation_lock:
        task = generation_tasks.get(task_id)
        if not task:
            return jsonify({"ok": False, "message": "task not found"}), 404

        state = task.get("state")
        request_id = str(task.get("request_id", "") or "")
        if state == "running":
            task["state"] = "stopping"
            task["stop_requested"] = True
            task["client_paused"] = False
            task["thinking"] = "正在停止..."
            runner_pid = task.get("runner_pid")
            runner_proc = task.get("runner_proc")
            generation_tasks[task_id] = task
        elif state == "stopping":
            runner_pid = task.get("runner_pid")
            runner_proc = task.get("runner_proc")
        elif state in {"stopped", "done", "error"}:
            project = load_project()
            _clear_generation_checkpoint(project, reason=f"already_{state}")
            _clear_pause_snapshot(project, reason=f"already_{state}")
            save_project(project)
            return jsonify({"ok": True, "state": state, "request_id": request_id})
        else:
            return jsonify({"ok": False, "message": "invalid task state"}), 400

    forced, detail = _force_stop_process(pid=runner_pid, proc=runner_proc)
    with _generation_lock:
        task = generation_tasks.get(task_id)
        if task and task.get("state") == "stopping":
            task["stop_detail"] = detail
            if forced:
                task["state"] = "stopped"
                task["message"] = "已强制停止"
            generation_tasks[task_id] = task

    if forced:
        project = load_project()
        _clear_generation_checkpoint(project, reason="force_stopped")
        _clear_pause_snapshot(project, reason="force_stopped")
        save_project(project)
        _log_with_request(request_id, f"force stopped task_id={task_id}")

    return jsonify(
        {
            "ok": True,
            "state": "stopped" if forced else "stopping",
            "forced": forced,
            "detail": detail,
            "request_id": request_id,
        }
    )


@app.route("/api/draft/accept", methods=["POST"])
def api_draft_accept():
    data = request.get_json(silent=True) or {}
    content = _text(data.get("content"))
    if not content:
        return jsonify({"draft_content": load_project().get("draft", {}).get("content", "")})

    project = load_project()
    draft = project.setdefault("draft", {})
    old = draft.get("content", "")

    if old and not old.endswith("\n"):
        old += "\n\n"
    draft["content"] = old + content

    summary = _cache_summary(draft["content"])
    cache_obj = project.get("cache", {})
    if not isinstance(cache_obj, dict):
        cache_obj = {"summary": _cache_summary(cache_obj)}

    existing_pack = str(cache_obj.get("context_pack", "") or "")
    context_pack = _generate_context_pack_with_timeout(draft["content"], existing_pack, timeout_seconds=15)

    cache_obj["summary"] = summary
    if context_pack:
        cache_obj["context_pack"] = context_pack
    cache_obj["updated_at"] = _now_text()
    project["cache"] = cache_obj

    save_project(project)

    return jsonify({"draft_content": draft["content"]})


@app.route("/api/draft/save", methods=["POST"])
def api_draft_save():
    data = request.get_json(silent=True) or {}
    content = str(data.get("content", "") or "")

    project = load_project()
    draft = project.setdefault("draft", {})
    draft["content"] = content

    cache_obj = project.get("cache", {})
    if not isinstance(cache_obj, dict):
        cache_obj = {"summary": _cache_summary(cache_obj)}
    cache_obj["summary"] = _cache_summary(content)
    cache_obj["updated_at"] = _now_text()
    project["cache"] = cache_obj

    save_project(project)

    return jsonify({"ok": True, "cache": _cache_summary(content), "content": content})


@app.route("/api/draft/delete", methods=["POST"])
def api_draft_delete():
    data = request.get_json(silent=True) or {}
    discarded_content = str(data.get("content", "") or "").strip()

    project = load_project()
    project.setdefault("draft", {})
    project["draft"]["last_generated"] = ""
    added_item = None
    if discarded_content and discarded_content != "(写作已停止)":
        added_item = _append_discarded_draft(project, discarded_content)
    save_project(project)
    return jsonify(
        {
            "ok": True,
            "discarded_added": bool(added_item),
            "discarded_item": added_item,
        }
    )


@app.route("/api/draft", methods=["GET"])
def api_get_draft():
    project = load_project()
    content = project.get("draft", {}).get("content", "")
    return jsonify({"content": content})


@app.route("/api/discarded", methods=["GET"])
def api_get_discarded():
    project = load_project()
    return jsonify({"items": _list_discarded_items(project)})


@app.route("/api/discarded/restore", methods=["POST"])
def api_restore_discarded():
    data = request.get_json(silent=True) or {}
    try:
        target_id = int(data.get("id", 0) or 0)
    except (TypeError, ValueError):
        target_id = 0
    if target_id <= 0:
        return jsonify({"ok": False, "message": "invalid id"}), 400

    project = load_project()
    store = _ensure_discarded_store(project)
    restored_item = None
    remaining = []
    for item in store.get("items", []):
        if not isinstance(item, dict):
            continue
        if int(item.get("id", 0) or 0) == target_id and restored_item is None:
            restored_item = item
            continue
        remaining.append(item)
    if restored_item is None:
        return jsonify({"ok": False, "message": "not found"}), 404

    store["items"] = remaining
    save_project(project)
    return jsonify(
        {
            "ok": True,
            "content": str(restored_item.get("content", "") or ""),
            "item": restored_item,
            "removed": True,
        }
    )


@app.route("/api/discarded/<int:item_id>", methods=["DELETE"])
def api_delete_discarded(item_id):
    project = load_project()
    store = _ensure_discarded_store(project)
    before = len(store.get("items", []))
    store["items"] = [
        x for x in store.get("items", [])
        if isinstance(x, dict) and int(x.get("id", 0) or 0) != int(item_id)
    ]
    if len(store["items"]) == before:
        return jsonify({"ok": False, "message": "not found"}), 404
    save_project(project)
    return jsonify({"ok": True})


@app.route("/api/upload-file", methods=["POST"])
def api_upload_file():
    target = _text(request.form.get("target"))
    if target not in {"outline", "reference"}:
        return jsonify({"ok": False, "message": "invalid target"}), 400

    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"ok": False, "message": "file is required"}), 400
    if not uploaded.filename.lower().endswith(".txt"):
        return jsonify({"ok": False, "message": "only .txt file is supported"}), 400

    raw = uploaded.read()
    if not raw:
        return jsonify({"ok": False, "message": "empty file"}), 400

    content = None
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            content = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if content is None or content == "":
        return jsonify({"ok": False, "message": "failed to read file"}), 400

    project = load_project()
    project.setdefault("config", {})
    project["config"][target] = content
    save_project(project)

    return jsonify({"ok": True, "content": content, "target": target})


@app.route("/api/chapter/split", methods=["POST"])
def api_chapter_split():
    data = request.get_json(silent=True) or {}
    content = _text(data.get("content"))

    if not content:
        project = load_project()
        content = project.get("draft", {}).get("content", "")

    result = split_chapter(content)
    if not result.get("ok"):
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/chapter/generate-title", methods=["POST"])
def api_chapter_generate_title():
    data = request.get_json(silent=True) or {}
    content = _text(data.get("content"))
    if not content:
        return jsonify({"ok": False, "message": "草稿为空，无法拟题。"}), 400

    title_result = generate_chapter_title(content)
    if not title_result.get("success"):
        return jsonify({"ok": False, "message": title_result.get("error") or "拟题失败"}), 400

    title = _text(title_result.get("title")) or "未名之章"
    return jsonify({"ok": True, "title": title})


@app.route("/api/chapter/save", methods=["POST"])
def api_chapter_save():
    data = request.get_json(silent=True) or {}
    content = _text(data.get("content"))
    title = _text(data.get("title"))

    result = save_chapter_with_title(content, title)
    if not result.get("ok"):
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/chapters", methods=["GET"])
def api_list_chapters():
    return jsonify(list_chapters())


@app.route("/api/chapters/<int:chapter_id>", methods=["GET"])
def api_get_chapter(chapter_id):
    chapter = get_chapter(chapter_id)
    if not chapter:
        return jsonify({"message": "chapter not found"}), 404
    return jsonify(
        {
            "id": chapter.get("id"),
            "title": chapter.get("title", ""),
            "content": chapter.get("content", ""),
        }
    )


@app.route("/api/chapters/<int:chapter_id>", methods=["DELETE"])
def api_delete_chapter(chapter_id):
    if not delete_chapter(chapter_id):
        return jsonify({"ok": False, "message": "chapter not found"}), 404
    return jsonify({"ok": True})


def _open_browser():
    webbrowser.open(f"http://127.0.0.1:{PORT}/")


def run_server(host="127.0.0.1", port=PORT, open_browser=False):
    ensure_output_dir()
    _sync_doubao_auth_from_env_on_startup()
    _apply_runtime_proxy_from_config(load_project().get("config", {}))
    _start_background_prewarm(force=False)
    if open_browser:
        timer = threading.Timer(1.5, _open_browser)
        timer.daemon = True
        timer.start()
    # Disable reloader so this can run inside a background thread for desktop mode.
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    run_server(open_browser=False)


