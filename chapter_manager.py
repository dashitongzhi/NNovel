import os
import re
import threading
from datetime import datetime

from codex_engine import (
    check_chapter_consistency,
    extract_structured_memory_updates,
    extract_global_memory_updates,
    generate_chapter_title,
)
from data_store import (
    get_active_output_dir,
    load_chapters,
    load_project,
    save_chapters,
    save_project,
)

_CHAPTER_LOCK = threading.Lock()
_CHAPTER_FILE_RE = re.compile(r"^chapter_(\d{3})_第(\d+)章_(.+)\.txt$", re.IGNORECASE)
_MEMORY_LINE_RE = re.compile(r"^\s*([^|｜]+)\s*[|｜]\s*([^|｜]+)\s*[|｜]\s*(.+?)\s*$")
_STRUCTURED_MEMORY_TYPES = ("人物", "地点", "状态", "关系")


def ensure_output_dir():
    os.makedirs(get_active_output_dir(), exist_ok=True)


def _sanitize_filename(name):
    safe = re.sub(r'[\\/:*?"<>|]', "_", name or "")
    safe = re.sub(r"\s+", "", safe)
    safe = safe.strip("._")
    if len(safe) > 60:
        safe = safe[:60]
    return safe or "untitled"


def _safe_int(value, default=-1):
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _safe_path(filename):
    """校验文件名安全性，防止路径穿越。返回安全的绝对路径或 None。"""
    if not filename:
        return None
    base = os.path.basename(filename)
    if not base or base != filename:
        return None
    output_dir = get_active_output_dir()
    full = os.path.join(output_dir, base)
    real = os.path.realpath(full)
    if not real.startswith(os.path.realpath(output_dir)):
        return None
    return full


def _infer_title_from_filename(filename):
    m = _CHAPTER_FILE_RE.match(filename or "")
    if not m:
        return "未名之章"
    raw = (m.group(3) or "").strip()
    if not raw:
        return "未名之章"
    return raw


def _bootstrap_chapters_from_output_if_needed(chapters_data):
    chapters = chapters_data.get("chapters", [])
    if isinstance(chapters, list) and chapters:
        return False

    ensure_output_dir()
    files = []
    try:
        for name in os.listdir(get_active_output_dir()):
            path = _safe_path(name)
            if not path or not os.path.isfile(path):
                continue
            m = _CHAPTER_FILE_RE.match(name)
            if not m:
                continue
            chapter_number = _safe_int(m.group(2), -1)
            if chapter_number < 1:
                continue
            files.append((chapter_number, name, path))
    except OSError:
        return False

    if not files:
        return False

    files.sort(key=lambda x: (x[0], x[1]))
    rebuilt = []
    for idx, (chapter_number, filename, path) in enumerate(files, start=1):
        content = ""
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                content = f.read()
        except Exception:
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                content = ""

        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            ts = os.path.getmtime(path)
            created_at = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
        except OSError:
            pass

        rebuilt.append(
            {
                "id": idx,
                "chapter_number": chapter_number,
                "title": _infer_title_from_filename(filename),
                "filename": filename,
                "char_count": _char_count(content),
                "created_at": created_at,
            }
        )

    chapters_data["chapters"] = rebuilt
    chapters_data["next_id"] = len(rebuilt) + 1
    return True


def _char_count(text):
    return len(re.sub(r"\s+", "", text or ""))


def _clean_memory_part(value, max_len):
    x = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    x = re.sub(r"\s+", " ", x)
    x = x.replace("|", "／").replace("｜", "／")
    if len(x) > max_len:
        x = x[:max_len]
    return x


def _normalize_memory_type(value):
    t = _clean_memory_part(value, 10)
    aliases = {
        "角色": "人物",
        "人物角色": "人物",
        "场景": "地点",
        "地点场景": "地点",
        "势力": "组织",
        "道具": "物品",
        "规则": "设定",
        "世界观": "设定",
        "剧情": "事件",
    }
    if t in aliases:
        t = aliases[t]
    if t not in {"人物", "地点", "组织", "物品", "设定", "事件"}:
        t = "设定"
    return t


def _memory_key(memory_type, name):
    return (
        re.sub(r"\s+", "", str(memory_type or "")).casefold(),
        re.sub(r"\s+", "", str(name or "")).casefold(),
    )


def _normalize_structured_memory_type(value):
    t = _clean_memory_part(value, 10)
    aliases = {
        "角色": "人物",
        "人物角色": "人物",
        "场景": "地点",
        "地点场景": "地点",
        "组织": "状态",
        "物品": "状态",
        "设定": "状态",
        "事件": "状态",
        "关系": "关系",
    }
    if t in aliases:
        t = aliases[t]
    if t not in _STRUCTURED_MEMORY_TYPES:
        t = "状态"
    return t


def _default_structured_memory():
    return {k: {} for k in _STRUCTURED_MEMORY_TYPES}


def _normalize_structured_entry(category, name, summary, updated_at=""):
    category = _normalize_structured_memory_type(category)
    clean_name = _clean_memory_part(name, 40)
    clean_summary = _clean_memory_part(summary, 300)
    clean_updated_at = _clean_memory_part(updated_at, 30)
    if not clean_name or not clean_summary:
        return None
    return {
        "type": category,
        "name": clean_name,
        "summary": clean_summary,
        "updated_at": clean_updated_at,
    }


def _normalize_structured_memory(value):
    normalized = _default_structured_memory()
    if not isinstance(value, dict):
        return normalized

    for category in _STRUCTURED_MEMORY_TYPES:
        raw_bucket = value.get(category, {})
        bucket = {}
        if isinstance(raw_bucket, dict):
            rows = []
            for k, v in raw_bucket.items():
                if isinstance(v, dict):
                    rows.append({"name": k, **v})
                else:
                    rows.append({"name": k, "summary": v})
        elif isinstance(raw_bucket, list):
            rows = raw_bucket
        else:
            rows = []

        for row in rows:
            if not isinstance(row, dict):
                continue
            entry = _normalize_structured_entry(
                category,
                row.get("name", ""),
                row.get("summary", ""),
                row.get("updated_at", ""),
            )
            if not entry:
                continue
            bucket[_memory_key(entry["type"], entry["name"])] = entry
        normalized[category] = bucket
    return normalized


def parse_text_memory_to_structured(text):
    parsed = _default_structured_memory()
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    for line in lines:
        item = _parse_memory_line(line)
        if not item:
            continue
        category = _normalize_structured_memory_type(item.get("type", "状态"))
        entry = _normalize_structured_entry(
            category,
            item.get("name", ""),
            item.get("summary", ""),
            "",
        )
        if not entry:
            continue
        parsed[category][_memory_key(entry["type"], entry["name"])] = entry
    return parsed


def _structured_to_serializable(structured_memory):
    normalized = _normalize_structured_memory(structured_memory)
    result = {}
    for category in _STRUCTURED_MEMORY_TYPES:
        bucket = normalized.get(category, {})
        rows = []
        for entry in bucket.values():
            rows.append(
                {
                    "name": entry.get("name", ""),
                    "summary": entry.get("summary", ""),
                    "updated_at": entry.get("updated_at", ""),
                }
            )
        rows.sort(key=lambda x: re.sub(r"\s+", "", str(x.get("name", ""))).casefold())
        result[category] = rows
    return result


def render_structured_memory_text(structured_memory):
    normalized = _normalize_structured_memory(structured_memory)
    lines = []
    for category in _STRUCTURED_MEMORY_TYPES:
        bucket = normalized.get(category, {})
        ordered = sorted(
            bucket.values(),
            key=lambda x: re.sub(r"\s+", "", str(x.get("name", ""))).casefold(),
        )
        for entry in ordered:
            name = _clean_memory_part(entry.get("name", ""), 40)
            summary = _clean_memory_part(entry.get("summary", ""), 300)
            if name and summary:
                lines.append(f"{category}|{name}|{summary}")
    return "\n".join(lines).strip()


def merge_structured_memory(existing_structured, updates):
    merged = _normalize_structured_memory(existing_structured)
    changed = False
    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for raw in updates or []:
        if not isinstance(raw, dict):
            continue
        category = _normalize_structured_memory_type(raw.get("type", "状态"))
        entry = _normalize_structured_entry(
            category,
            raw.get("name", ""),
            raw.get("summary", ""),
            now_text,
        )
        if not entry:
            continue
        key = _memory_key(entry["type"], entry["name"])
        bucket = merged.setdefault(category, {})
        prev = bucket.get(key)
        if not prev:
            bucket[key] = entry
            changed = True
            continue

        prev_summary = _clean_memory_part(prev.get("summary", ""), 300)
        if prev_summary != entry["summary"]:
            bucket[key] = entry
            changed = True
            continue

        if not prev.get("updated_at"):
            prev["updated_at"] = now_text
            changed = True

    return merged, changed


def normalize_memory_config_from_text(global_memory_text, global_memory_structured=None):
    base_structured = _normalize_structured_memory(global_memory_structured)
    text_structured = parse_text_memory_to_structured(global_memory_text)
    merged, _ = merge_structured_memory(base_structured, [
        {"type": cat, "name": entry.get("name", ""), "summary": entry.get("summary", "")}
        for cat in _STRUCTURED_MEMORY_TYPES
        for entry in text_structured.get(cat, {}).values()
    ])
    rendered = render_structured_memory_text(merged)
    serializable = _structured_to_serializable(merged)
    return rendered, serializable


def _parse_memory_line(line):
    m = _MEMORY_LINE_RE.match(str(line or "").strip())
    if not m:
        return None
    memory_type = _normalize_memory_type(m.group(1))
    name = _clean_memory_part(m.group(2), 30)
    summary = _clean_memory_part(m.group(3), 220)
    if not name or not summary:
        return None
    return {"type": memory_type, "name": name, "summary": summary}


def _render_memory_line(item):
    memory_type = _normalize_memory_type(item.get("type", "设定"))
    name = _clean_memory_part(item.get("name", ""), 30)
    summary = _clean_memory_part(item.get("summary", ""), 220)
    if not name or not summary:
        return ""
    return f"{memory_type}|{name}|{summary}"


def _merge_global_memory(existing_memory, updates):
    base_lines = str(existing_memory or "").replace("\r\n", "\n").split("\n")

    layout = []
    structured = {}
    seen_keys = set()

    for raw in base_lines:
        line = str(raw or "").strip()
        if not line:
            continue
        item = _parse_memory_line(line)
        if not item:
            layout.append(("raw", line))
            continue

        key = _memory_key(item["type"], item["name"])
        if key not in seen_keys:
            layout.append(("structured", key))
            seen_keys.add(key)
        structured[key] = item

    for item in updates or []:
        if not isinstance(item, dict):
            continue
        normalized = {
            "type": _normalize_memory_type(item.get("type", "")),
            "name": _clean_memory_part(item.get("name", ""), 30),
            "summary": _clean_memory_part(item.get("summary", ""), 220),
        }
        if not normalized["name"] or not normalized["summary"]:
            continue
        key = _memory_key(normalized["type"], normalized["name"])
        structured[key] = normalized
        if key not in seen_keys:
            layout.append(("structured", key))
            seen_keys.add(key)

    rendered = []
    for kind, value in layout:
        if kind == "raw":
            rendered.append(value)
            continue
        item = structured.get(value)
        if not item:
            continue
        line = _render_memory_line(item)
        if line:
            rendered.append(line)

    merged = "\n".join(rendered).strip()
    changed = merged != str(existing_memory or "").replace("\r\n", "\n").strip()
    return merged, changed


def _get_chapter_number(chapters_data):
    """根据当前已有章节数量计算下一个章节序号。"""
    chapters = chapters_data.get("chapters", [])
    if not isinstance(chapters, list):
        return 1
    return len(chapters) + 1


def format_chapter_text(chapter_number, title, body):
    title = (title or "").strip() or "未名之章"
    body = (body or "").replace("\r\n", "\n").strip()

    full_title = f"第{chapter_number}章 {title}"

    raw_paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    if not raw_paragraphs:
        raw_paragraphs = [p.strip() for p in body.split("\n") if p.strip()]

    paragraphs = []
    for p in raw_paragraphs:
        p = re.sub(r"\n+", "", p).strip()
        if p:
            paragraphs.append("\u3000\u3000" + p)

    body_text = "\n\n".join(paragraphs)
    width = max(24, len(full_title) + 8)
    left_pad = max(0, (width - len(full_title)) // 2)
    title_line = (" " * left_pad) + full_title
    return f"{title_line}\n\n{body_text}\n"


def save_chapter_file(chapter_number, title, formatted_text):
    ensure_output_dir()
    safe_title = _sanitize_filename(title)
    filename = f"chapter_{chapter_number:03d}_第{chapter_number}章_{safe_title}.txt"
    path = os.path.join(get_active_output_dir(), filename)
    with open(path, "w", encoding="utf-8-sig") as f:
        f.write(formatted_text)
    return filename


def save_chapter_with_title(content, title):
    body = (content or "").strip()
    if not body:
        return {"ok": False, "message": "草稿为空，无法分章。"}

    chapter_title = (title or "").strip() or "未名之章"

    with _CHAPTER_LOCK:
        chapters_data = load_chapters()
        chapter_id = _safe_int(chapters_data.get("next_id", 1), 1)
        chapter_number = _get_chapter_number(chapters_data)

        formatted_text = format_chapter_text(chapter_number, chapter_title, body)
        filename = save_chapter_file(chapter_number, chapter_title, formatted_text)

        chapter_meta = {
            "id": chapter_id,
            "chapter_number": chapter_number,
            "title": chapter_title,
            "filename": filename,
            "char_count": _char_count(body),
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        chapters_data.setdefault("chapters", []).append(chapter_meta)
        chapters_data["next_id"] = chapter_id + 1
        save_chapters(chapters_data)

    project = load_project()
    project.setdefault("draft", {})
    project["draft"]["content"] = ""
    project["draft"]["last_generated"] = ""

    stats = project.setdefault("stats", {})
    stats["total_chars"] = int(stats.get("total_chars", 0)) + _char_count(body)
    stats["total_chapters"] = int(stats.get("total_chapters", 0)) + 1

    memory_updated = False
    memory_error = ""
    consistency_checked = False
    consistency_has_conflicts = False
    consistency_summary = ""
    consistency_conflicts = []
    consistency_error = ""
    config = project.setdefault("config", {})
    existing_memory = str(config.get("global_memory", "") or "")
    existing_structured = _normalize_structured_memory(config.get("global_memory_structured", {}))
    if existing_memory and not render_structured_memory_text(existing_structured):
        existing_structured = parse_text_memory_to_structured(existing_memory)

    memory_result = extract_structured_memory_updates(
        body,
        _structured_to_serializable(existing_structured),
        existing_memory,
    )
    update_items = []
    if memory_result.get("success"):
        update_items = memory_result.get("items", [])
    else:
        # Backward fallback: keep old memory extraction pathway.
        legacy_result = extract_global_memory_updates(body, existing_memory)
        if legacy_result.get("success"):
            update_items = legacy_result.get("items", [])
        else:
            memory_error = str(memory_result.get("error") or "").strip() or str(
                legacy_result.get("error") or ""
            ).strip()

    if update_items:
        merged_structured, changed = merge_structured_memory(existing_structured, update_items)
        merged_memory = render_structured_memory_text(merged_structured)
        config["global_memory_structured"] = _structured_to_serializable(merged_structured)
        config["global_memory"] = merged_memory
        memory_updated = changed or (merged_memory != existing_memory)
    elif not memory_error:
        # Keep stored format normalized even if no delta extracted.
        config["global_memory_structured"] = _structured_to_serializable(existing_structured)
        config["global_memory"] = render_structured_memory_text(existing_structured)

    consistency_result = check_chapter_consistency(
        chapter_text=body,
        global_memory=str(config.get("global_memory", "") or existing_memory),
        outline=str(config.get("outline", "") or ""),
        reference=str(config.get("reference", "") or ""),
        requirements=str(config.get("requirements", "") or ""),
        extra_settings=str(config.get("extra_settings", "") or ""),
    )
    if consistency_result.get("success"):
        consistency_checked = True
        consistency_has_conflicts = bool(consistency_result.get("has_conflicts"))
        consistency_summary = str(consistency_result.get("summary", "") or "").strip()
        raw_conflicts = consistency_result.get("conflicts", [])
        if isinstance(raw_conflicts, list):
            consistency_conflicts = [x for x in raw_conflicts if isinstance(x, dict)]
    else:
        consistency_error = str(consistency_result.get("error") or "").strip()

    save_project(project)

    return {
        "ok": True,
        "title": chapter_title,
        "filename": filename,
        "chapter_number": chapter_number,
        "memory_updated": memory_updated,
        "memory_error": memory_error,
        "global_memory": config.get("global_memory", ""),
        "global_memory_structured": config.get("global_memory_structured", {}),
        "consistency_checked": consistency_checked,
        "consistency_has_conflicts": consistency_has_conflicts,
        "consistency_summary": consistency_summary,
        "consistency_conflicts": consistency_conflicts,
        "consistency_error": consistency_error,
    }


def split_chapter(draft_content):
    body = (draft_content or "").strip()
    if not body:
        return {"ok": False, "message": "草稿为空，无法分章。"}

    title_result = generate_chapter_title(body)
    if not title_result["success"]:
        return {"ok": False, "message": title_result.get("error") or "拟题失败"}

    title = (title_result.get("title") or "").strip() or "未名之章"
    return save_chapter_with_title(body, title)


def list_chapters():
    with _CHAPTER_LOCK:
        ensure_output_dir()
        chapters_data = load_chapters()
        changed = _bootstrap_chapters_from_output_if_needed(chapters_data)
        chapters = chapters_data.get("chapters", [])
        if not isinstance(chapters, list):
            return []

        existing = []
        removed_any = False
        for item in chapters:
            if not isinstance(item, dict):
                removed_any = True
                continue

            filename = str(item.get("filename", "")).strip()
            if not filename:
                removed_any = True
                continue

            path = _safe_path(filename)
            if path and os.path.exists(path):
                existing.append(item)
            else:
                removed_any = True

        if removed_any:
            chapters_data["chapters"] = existing
            _renumber_chapters(chapters_data)
            save_chapters(chapters_data)
        elif changed:
            save_chapters(chapters_data)

    return sorted(existing, key=lambda x: _safe_int(x.get("id", 0), 0))


def _renumber_chapters(chapters_data):
    """删除章节后重新编号，更新文件名和文件内标题中的章节序号。"""
    chapters = chapters_data.get("chapters", [])
    if not isinstance(chapters, list):
        return
    chapters.sort(key=lambda x: _safe_int(x.get("id", 0), 0))

    for idx, item in enumerate(chapters, start=1):
        old_number = _safe_int(item.get("chapter_number", 0), 0)
        if old_number == idx:
            continue

        old_filename = item.get("filename", "")
        old_path = _safe_path(old_filename)

        content = ""
        if old_path and os.path.exists(old_path):
            try:
                with open(old_path, "r", encoding="utf-8-sig") as f:
                    content = f.read()
            except Exception:
                try:
                    with open(old_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                except Exception:
                    pass

        if content:
            content = re.sub(
                r"第\d+章",
                f"第{idx}章",
                content,
                count=1,
            )

        title = item.get("title", "未名之章")
        safe_title = _sanitize_filename(title)
        new_filename = f"chapter_{idx:03d}_第{idx}章_{safe_title}.txt"
        new_path = _safe_path(new_filename)

        if not new_path:
            item["chapter_number"] = idx
            item["filename"] = new_filename
            continue

        if content:
            with open(new_path, "w", encoding="utf-8-sig") as f:
                f.write(content)
        elif old_path and os.path.exists(old_path):
            try:
                os.rename(old_path, new_path)
            except OSError:
                pass
            item["chapter_number"] = idx
            item["filename"] = new_filename
            continue

        if old_path and os.path.exists(old_path) and os.path.normpath(old_path) != os.path.normpath(new_path):
            try:
                os.remove(old_path)
            except OSError:
                pass

        item["chapter_number"] = idx
        item["filename"] = new_filename


def delete_chapter(chapter_id):
    target_id = _safe_int(chapter_id, -1)
    if target_id < 0:
        return False

    with _CHAPTER_LOCK:
        chapters_data = load_chapters()
        chapters = chapters_data.get("chapters", [])
        if not isinstance(chapters, list):
            return False

        removed = None
        remaining = []
        for item in chapters:
            if not isinstance(item, dict):
                continue
            if _safe_int(item.get("id", -1), -1) == target_id and removed is None:
                removed = item
                continue
            remaining.append(item)

        if removed is None:
            return False

        filename = str(removed.get("filename", "")).strip()
        if filename:
            path = _safe_path(filename)
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

        chapters_data["chapters"] = remaining
        _renumber_chapters(chapters_data)
        save_chapters(chapters_data)
    return True


def get_chapter(chapter_id):
    target_id = _safe_int(chapter_id, -1)
    if target_id < 0:
        return None
    for item in list_chapters():
        if _safe_int(item.get("id", -1), -1) == target_id:
            filename = item.get("filename", "")
            path = _safe_path(filename)
            if not path or not os.path.exists(path):
                return {
                    "id": item.get("id"),
                    "title": item.get("title", ""),
                    "content": "",
                }

            try:
                with open(path, "r", encoding="utf-8-sig") as f:
                    content = f.read()
            except Exception:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

            return {
                "id": item.get("id"),
                "title": item.get("title", ""),
                "content": content,
            }
    return None
