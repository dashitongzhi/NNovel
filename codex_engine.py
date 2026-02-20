import re
import subprocess
import threading
import os
import sys
import tempfile
import time
import shutil
import json
import ssl
import socket
import http.client
import urllib.error
import urllib.request
import urllib.parse
import pathlib
import importlib
from collections import deque

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:
    try:
        tomllib = importlib.import_module("tomli")  # Python < 3.11 fallback
    except ModuleNotFoundError:
        tomllib = None

from config import CHARS_PER_BATCH, CODEX_TIMEOUT, GEMINI_TIMEOUT, PROJECT_DIR
from data_store import load_project

THINKING_PHASES = [
    (0, "正在理解故事大纲，分析人物关系..."),
    (5, "正在构思本段情节的发展方向..."),
    (15, "正在撰写场景描写与人物对话..."),
    (30, "正在深入刻画人物内心活动..."),
    (50, "正在推进故事情节，制造冲突与悬念..."),
    (70, "正在润色文字，调整节奏与氛围..."),
    (90, "即将完成，进行最后的文字打磨..."),
]

_PROGRESS_POLL_INTERVAL = 1.0
_ESTIMATED_SECONDS = 60
_PROJECT_API_CONFIG_PATH = pathlib.Path(PROJECT_DIR) / "model_api.toml"
_PROJECT_API_AUTH_PATH = pathlib.Path(PROJECT_DIR) / "auth.json"
_DOUBAO_RESPONSES_URL = "https://ark.cn-beijing.volces.com/api/v3/responses"
_DOUBAO_DEFAULT_MODEL = "doubao-seed-1-6-251015"
_PERSONAL_DEFAULT_MODEL = "deepseek-ai/deepseek-v3.2"
_DOUBAO_MODEL_FALLBACKS = (
    "doubao-seed-1-6-251015",
    "doubao-seed-1-6-lite-251015",
    "doubao-seed-1-6-flash-250828",
)
_DOUBAO_HTTP_TIMEOUT = int(os.environ.get("DOUBAO_TIMEOUT", str(CODEX_TIMEOUT)))
_DOUBAO_HTTP_RETRIES = max(1, min(6, int(os.environ.get("DOUBAO_RETRIES", "4"))))
_DOUBAO_DISABLE_PROXY = str(os.environ.get("DOUBAO_DISABLE_PROXY", "1")).strip().lower() not in {"0", "false", "no"}
_DEFAULT_PROXY_PORT = "10808"
_ENGINE_RUNTIME_LOCK = threading.Lock()
_ENGINE_RUNTIME = {
    "last_engine": "",
    "last_model": "",
    "last_error": "",
    "last_error_code": "",
    "attempt_total": 0,
    "success_total": 0,
    "failover_total": 0,
    "updated_at": 0.0,
}
_MODEL_HEALTH_LOCK = threading.Lock()
_MODEL_HEALTH_WINDOW = max(5, min(100, int(os.environ.get("MODEL_HEALTH_WINDOW", "30"))))
_MODEL_FAILURE_COOLDOWN_SECS = {
    "quota": 35.0,
    "auth_key_missing": 40.0,
    "auth_key_invalid": 90.0,
    "auth_permission": 90.0,
    "auth": 60.0,
    "transport_proxy": 16.0,
    "transport_tls": 20.0,
    "transport_timeout": 12.0,
    "transport": 10.0,
    "timeout": 10.0,
    "unknown": 6.0,
}
_MODEL_HEALTH = {}


def infer_error_code(message):
    text = str(message or "").strip().lower()
    if not text:
        return "unknown"
    if "stopped by user" in text or "已停止" in text:
        return "stopped"
    if any(k in text for k in ("quota", "insufficient", "balance", "credit", "额度不足", "余额不足", "配额不足")):
        return "quota"

    if any(
        k in text
        for k in (
            "missing api key",
            "api key missing",
            "no api key",
            "apikey missing",
            "需要密钥",
            "缺少密钥",
            "key missing",
        )
    ):
        return "auth_key_missing"
    if any(
        k in text
        for k in (
            "invalid api key",
            "bad api key",
            "invalid token",
            "token expired",
            "unauthorized",
            "http 401",
            "401",
            "令牌失效",
            "认证失败",
            "鉴权失败",
        )
    ):
        return "auth_key_invalid"
    if any(
        k in text
        for k in (
            "forbidden",
            "permission denied",
            "access denied",
            "http 403",
            "403",
            "无权限",
            "权限不足",
        )
    ):
        return "auth_permission"

    if any(
        k in text
        for k in (
            "proxy",
            "socks",
            "tunnel",
            "http 407",
            "proxyerror",
            "代理",
        )
    ):
        return "transport_proxy"
    if any(
        k in text
        for k in (
            "tls",
            "ssl",
            "certificate",
            "unexpected_eof_while_reading",
            "eof occurred in violation of protocol",
            "wrong version number",
            "证书",
        )
    ):
        return "transport_tls"
    if any(
        k in text
        for k in (
            "connect timeout",
            "read timeout",
            "timed out",
            "timeout",
            "超时",
            "connection timeout",
        )
    ):
        return "transport_timeout"
    if any(k in text for k in ("connection", "transport", "network", "连接", "网络")):
        return "transport"
    return "unknown"


def _model_health_key(engine, model):
    return f"{str(engine or '').strip().lower()}::{str(model or '').strip()}"


def _model_health_bucket(engine, model):
    key = _model_health_key(engine, model)
    bucket = _MODEL_HEALTH.get(key)
    if bucket is None:
        bucket = {
            "engine": str(engine or "").strip().lower(),
            "model": str(model or "").strip(),
            "attempt_total": 0,
            "success_total": 0,
            "failure_total": 0,
            "failover_total": 0,
            "recent": deque(maxlen=_MODEL_HEALTH_WINDOW),
            "cooldown_until": 0.0,
            "weight_bias": 0.0,
            "last_error_code": "",
            "last_error": "",
            "updated_at": 0.0,
        }
        _MODEL_HEALTH[key] = bucket
    return bucket


def _health_cooldown_seconds(error_code):
    code = str(error_code or "").strip().lower()
    return float(_MODEL_FAILURE_COOLDOWN_SECS.get(code, _MODEL_FAILURE_COOLDOWN_SECS["unknown"]))


def _health_mark_attempt(engine, model):
    with _MODEL_HEALTH_LOCK:
        bucket = _model_health_bucket(engine, model)
        bucket["attempt_total"] = int(bucket.get("attempt_total", 0)) + 1
        bucket["updated_at"] = time.time()


def _health_mark_success(engine, model, total_ms=None, first_token_ms=None, failover=False):
    with _MODEL_HEALTH_LOCK:
        bucket = _model_health_bucket(engine, model)
        bucket["success_total"] = int(bucket.get("success_total", 0)) + 1
        if failover:
            bucket["failover_total"] = int(bucket.get("failover_total", 0)) + 1
        bucket["cooldown_until"] = 0.0
        bucket["weight_bias"] = min(8.0, float(bucket.get("weight_bias", 0.0)) + 1.0)
        bucket["last_error_code"] = ""
        bucket["last_error"] = ""
        bucket["updated_at"] = time.time()
        bucket["recent"].append(
            {
                "ok": True,
                "total_ms": float(total_ms) if total_ms is not None else None,
                "first_token_ms": float(first_token_ms) if first_token_ms is not None else None,
                "ts": time.time(),
            }
        )


def _health_mark_failure(engine, model, error_code, error_message="", total_ms=None, first_token_ms=None):
    code = str(error_code or "unknown").strip().lower() or "unknown"
    with _MODEL_HEALTH_LOCK:
        bucket = _model_health_bucket(engine, model)
        bucket["failure_total"] = int(bucket.get("failure_total", 0)) + 1
        bucket["weight_bias"] = max(-8.0, float(bucket.get("weight_bias", 0.0)) - 1.2)
        bucket["cooldown_until"] = max(
            float(bucket.get("cooldown_until", 0.0)),
            time.time() + _health_cooldown_seconds(code),
        )
        bucket["last_error_code"] = code
        bucket["last_error"] = str(error_message or "")
        bucket["updated_at"] = time.time()
        bucket["recent"].append(
            {
                "ok": False,
                "error_code": code,
                "total_ms": float(total_ms) if total_ms is not None else None,
                "first_token_ms": float(first_token_ms) if first_token_ms is not None else None,
                "ts": time.time(),
            }
        )


def _model_health_metrics(bucket):
    recent = list(bucket.get("recent") or [])
    recent_n = len(recent)
    success_n = sum(1 for x in recent if x.get("ok"))
    total_vals = [float(x["total_ms"]) for x in recent if x.get("total_ms") is not None]
    first_vals = [float(x["first_token_ms"]) for x in recent if x.get("first_token_ms") is not None]
    avg_total = (sum(total_vals) / len(total_vals)) if total_vals else None
    avg_first = (sum(first_vals) / len(first_vals)) if first_vals else None
    success_rate = (success_n / recent_n) if recent_n else None
    cooldown_remain_ms = max(0.0, (float(bucket.get("cooldown_until", 0.0)) - time.time()) * 1000.0)
    return {
        "engine": str(bucket.get("engine", "") or ""),
        "model": str(bucket.get("model", "") or ""),
        "recent_n": recent_n,
        "success_n": success_n,
        "success_rate": success_rate,
        "avg_first_token_ms": avg_first,
        "avg_total_ms": avg_total,
        "cooldown_ms": cooldown_remain_ms,
        "weight_bias": float(bucket.get("weight_bias", 0.0)),
        "last_error_code": str(bucket.get("last_error_code", "") or ""),
        "last_error": str(bucket.get("last_error", "") or ""),
        "updated_at": float(bucket.get("updated_at", 0.0) or 0.0),
    }


def _model_health_panel(limit=12):
    with _MODEL_HEALTH_LOCK:
        rows = [_model_health_metrics(bucket) for bucket in _MODEL_HEALTH.values()]
    rows.sort(key=lambda x: x.get("updated_at", 0.0), reverse=True)
    return rows[: max(1, int(limit or 12))]


def _rank_models_for_failover(engine, models):
    ordered = []
    seen = set()
    for item in models or []:
        model = str(item or "").strip()
        if not model:
            continue
        key = model.casefold()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(model)
    if len(ordered) <= 1:
        return ordered

    now = time.time()
    with _MODEL_HEALTH_LOCK:
        scored = []
        for idx, model in enumerate(ordered):
            bucket = _model_health_bucket(engine, model)
            metrics = _model_health_metrics(bucket)
            in_cooldown = metrics["cooldown_ms"] > 0
            base_rate = metrics["success_rate"] if metrics["success_rate"] is not None else 0.5
            score = base_rate * 100.0 + metrics["weight_bias"] * 6.0 - idx * 0.5
            # Give a tiny recency boost when model just succeeded.
            if bucket.get("recent"):
                last = list(bucket["recent"])[-1]
                if last.get("ok"):
                    age_s = max(0.0, now - float(last.get("ts", now)))
                    score += max(0.0, 12.0 - min(12.0, age_s))
            scored.append((in_cooldown, -score, idx, model))
    scored.sort(key=lambda x: (x[0], x[1], x[2]))
    return [x[3] for x in scored]


def _runtime_mark_attempt(engine, model):
    with _ENGINE_RUNTIME_LOCK:
        _ENGINE_RUNTIME["attempt_total"] = int(_ENGINE_RUNTIME.get("attempt_total", 0)) + 1
        _ENGINE_RUNTIME["last_engine"] = str(engine or "")
        _ENGINE_RUNTIME["last_model"] = str(model or "")
        _ENGINE_RUNTIME["updated_at"] = time.time()
    _health_mark_attempt(engine, model)


def _runtime_mark_success(engine, model, failover=False, total_ms=None, first_token_ms=None):
    with _ENGINE_RUNTIME_LOCK:
        _ENGINE_RUNTIME["success_total"] = int(_ENGINE_RUNTIME.get("success_total", 0)) + 1
        if failover:
            _ENGINE_RUNTIME["failover_total"] = int(_ENGINE_RUNTIME.get("failover_total", 0)) + 1
        _ENGINE_RUNTIME["last_engine"] = str(engine or "")
        _ENGINE_RUNTIME["last_model"] = str(model or "")
        _ENGINE_RUNTIME["last_error"] = ""
        _ENGINE_RUNTIME["last_error_code"] = ""
        _ENGINE_RUNTIME["updated_at"] = time.time()
    _health_mark_success(engine, model, total_ms=total_ms, first_token_ms=first_token_ms, failover=failover)


def _runtime_mark_error(engine, model, message, total_ms=None, first_token_ms=None):
    error_code = infer_error_code(message)
    with _ENGINE_RUNTIME_LOCK:
        _ENGINE_RUNTIME["last_engine"] = str(engine or "")
        _ENGINE_RUNTIME["last_model"] = str(model or "")
        _ENGINE_RUNTIME["last_error"] = str(message or "")
        _ENGINE_RUNTIME["last_error_code"] = error_code
        _ENGINE_RUNTIME["updated_at"] = time.time()
    _health_mark_failure(
        engine,
        model,
        error_code=error_code,
        error_message=message,
        total_ms=total_ms,
        first_token_ms=first_token_ms,
    )


def _runtime_snapshot():
    with _ENGINE_RUNTIME_LOCK:
        return dict(_ENGINE_RUNTIME)


def _normalize_claude_model(value):
    x = str(value or "").strip().lower()
    if not x:
        return "sonnet"
    if x in {"opus", "sonnet", "haiku"}:
        return x
    if "opus" in x:
        return "opus"
    if "haiku" in x:
        return "haiku"
    if "sonnet" in x:
        return "sonnet"
    return "sonnet"


def _get_executable_dir():
    """获取可执行文件所在目录（支持打包后的exe）"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后
        return os.path.dirname(sys.executable)
    else:
        # 开发环境
        return os.path.dirname(os.path.abspath(__file__))


def _get_config_search_paths():
    """获取配置文件搜索路径列表（按优先级排序）"""
    paths = []
    
    # 1. 环境变量指定的路径（最高优先级）
    if PROJECT_DIR:
        paths.append(PROJECT_DIR)
    
    # 2. exe所在目录（打包后的主要路径）
    exe_dir = _get_executable_dir()
    if exe_dir not in paths:
        paths.append(exe_dir)
    
    # 3. exe目录下的data子目录
    data_dir = os.path.join(exe_dir, "data")
    if data_dir not in paths:
        paths.append(data_dir)
    
    # 4. 用户目录下的应用配置目录
    user_config = os.path.join(os.path.expanduser("~"), ".nnovel")
    if user_config not in paths:
        paths.append(user_config)
    
    return paths


def _find_config_file(filename):
    """在多个路径中查找配置文件"""
    for base_path in _get_config_search_paths():
        filepath = os.path.join(base_path, filename)
        if os.path.exists(filepath):
            return filepath
    return None


def _resolve_codex_from_powershell():
    ps = _resolve_powershell_cmd()
    try:
        p = subprocess.run(
            [
                ps,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$c=Get-Command codex -ErrorAction SilentlyContinue; if ($c) { $c.Source }",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
        )
        candidate = (p.stdout or "").strip().strip('"')
        if candidate and os.path.exists(candidate):
            return candidate
    except Exception:
        pass

    # Allow shell-level wrapper/alias usage.
    try:
        p = subprocess.run(
            [
                ps,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "codex --help",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
        )
        if p.returncode == 0:
            return "codex"
    except Exception:
        pass
    return ""


def _resolve_env_cli_cmd(*keys):
    for key in keys:
        value = str(os.environ.get(key, "") or "").strip().strip('"')
        if not value:
            continue
        if os.path.exists(value):
            return value
        found = shutil.which(value)
        if found:
            return found
    return ""


def _resolve_codex_cmd():
    override = _resolve_env_cli_cmd("NNOVEL_CODEX_CMD", "CODEX_CMD")
    if override:
        return override
    # Only use PowerShell-based resolution.
    return _resolve_codex_from_powershell()


def _resolve_gemini_cmd():
    override = _resolve_env_cli_cmd("NNOVEL_GEMINI_CMD", "GEMINI_CMD")
    if override:
        return override
    return shutil.which("gemini") or ""


def _resolve_claude_cmd():
    override = _resolve_env_cli_cmd("NNOVEL_CLAUDE_CMD", "CLAUDE_CMD")
    if override:
        return override
    return shutil.which("claude") or ""


def _resolve_git_bash_path():
    # Allow explicit override first.
    override = str(os.environ.get("CLAUDE_CODE_GIT_BASH_PATH", "")).strip()
    if override and os.path.exists(override):
        return override

    candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ]

    git_cmd = shutil.which("git")
    if git_cmd:
        base = os.path.dirname(os.path.dirname(git_cmd))
        candidates.append(os.path.join(base, "bin", "bash.exe"))

    for p in candidates:
        if p and os.path.exists(p):
            return p
    return ""


def _resolve_powershell_cmd():
    for name in ("pwsh", "powershell"):
        found = shutil.which(name)
        if found:
            return found
    return "powershell"


def _existing_path(candidates):
    for item in candidates or []:
        path = str(item or "").strip()
        if not path:
            continue
        try:
            if os.path.exists(path):
                return path
        except Exception:
            continue
    return ""


def _cli_config_path(engine):
    name = str(engine or "").strip().lower()
    home = pathlib.Path.home()
    appdata = str(os.environ.get("APPDATA", "") or "").strip()
    local_appdata = str(os.environ.get("LOCALAPPDATA", "") or "").strip()

    if name == "codex":
        codex_home = str(os.environ.get("CODEX_HOME", "") or "").strip() or str(home / ".codex")
        return _existing_path(
            [
                os.path.join(codex_home, "auth.json"),
                os.path.join(codex_home, "config.toml"),
                os.path.join(codex_home, "model_providers.json"),
                codex_home,
            ]
        )

    if name == "gemini":
        return _existing_path(
            [
                str(os.environ.get("GEMINI_HOME", "") or "").strip(),
                str(home / ".gemini" / "settings.json"),
                str(home / ".gemini" / "config.json"),
                str(home / ".gemini"),
                str(home / ".config" / "gemini" / "config.json"),
                str(home / ".config" / "gemini"),
                os.path.join(appdata, "gemini") if appdata else "",
                os.path.join(local_appdata, "gemini") if local_appdata else "",
            ]
        )

    if name == "claude":
        return _existing_path(
            [
                str(os.environ.get("CLAUDE_HOME", "") or "").strip(),
                str(home / ".claude.json"),
                str(home / ".claude" / "settings.json"),
                str(home / ".claude" / "config.json"),
                str(home / ".claude"),
                os.path.join(appdata, "Claude") if appdata else "",
                os.path.join(local_appdata, "Claude") if local_appdata else "",
            ]
        )

    return ""


def _get_engine_config():
    try:
        project = load_project()
    except Exception:
        project = {}
    config = project.get("config", {}) if isinstance(project, dict) else {}
    if not isinstance(config, dict):
        config = {}
    mode = str(config.get("engine_mode", "codex")).strip().lower()
    if mode not in {"api", "codex", "gemini", "doubao", "claude", "personal"}:
        mode = "codex"
    return {
        "mode": mode,
        "api_base_url": str(config.get("api_base_url", "")).strip(),
        "api_key": str(config.get("api_key", "")).strip(),
        "api_model": str(config.get("api_model", "")).strip(),
        "codex_model": str(config.get("codex_model", "")).strip(),
        "gemini_model": str(config.get("gemini_model", "")).strip(),
        "claude_model": _normalize_claude_model(config.get("claude_model", "sonnet")),
        "codex_access_mode": str(config.get("codex_access_mode", "cli")).strip().lower(),
        "gemini_access_mode": str(config.get("gemini_access_mode", "cli")).strip().lower(),
        "claude_access_mode": str(config.get("claude_access_mode", "cli")).strip().lower(),
        "codex_reasoning_effort": str(config.get("codex_reasoning_effort", "")).strip().lower(),
        "gemini_reasoning_effort": str(config.get("gemini_reasoning_effort", "")).strip().lower(),
        "claude_reasoning_effort": str(config.get("claude_reasoning_effort", "")).strip().lower(),
        "doubao_reasoning_effort": str(config.get("doubao_reasoning_effort", "")).strip().lower(),
        "doubao_model": str(config.get("doubao_model", "")).strip(),
        "doubao_models": str(config.get("doubao_models", "")).strip(),
        "doubao_api_key": str(config.get("doubao_api_key", "")).strip(),
        "personal_models": str(config.get("personal_models", "")).strip(),
        "personal_model": str(config.get("personal_model", _PERSONAL_DEFAULT_MODEL)).strip() or _PERSONAL_DEFAULT_MODEL,
        "proxy_port": str(config.get("proxy_port", _DEFAULT_PROXY_PORT)).strip(),
    }


def _normalize_reasoning_effort(value):
    x = str(value or "").strip().lower()
    if x in {"low", "medium", "high"}:
        return x
    return "medium"


def _normalize_access_mode(value):
    x = str(value or "").strip().lower()
    if x in {"cli", "api"}:
        return x
    return "cli"


def _get_engine_runtime_access(cfg, mode=None):
    engine = str(mode or cfg.get("mode", "") or "").strip().lower()
    if engine == "gemini":
        return _normalize_access_mode(cfg.get("gemini_access_mode", "cli"))
    if engine == "claude":
        return _normalize_access_mode(cfg.get("claude_access_mode", "cli"))
    if engine == "codex":
        return _normalize_access_mode(cfg.get("codex_access_mode", "cli"))
    return "cli"


def _normalize_proxy_port(value):
    x = str(value or "").strip()
    if not x:
        return _DEFAULT_PROXY_PORT
    try:
        n = int(x)
    except (TypeError, ValueError):
        return _DEFAULT_PROXY_PORT
    if 1 <= n <= 65535:
        return str(n)
    return _DEFAULT_PROXY_PORT


def _proxy_url_from_cfg(cfg):
    proxy_port = _normalize_proxy_port((cfg or {}).get("proxy_port", _DEFAULT_PROXY_PORT))
    return f"http://127.0.0.1:{proxy_port}"


def _build_cli_proxy_env(cfg):
    env = os.environ.copy()
    proxy_url = _proxy_url_from_cfg(cfg)
    # Keep existing values; only fill when missing.
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        if not str(env.get(key, "") or "").strip():
            env[key] = proxy_url
    if not str(env.get("ALL_PROXY", "") or "").strip():
        env["ALL_PROXY"] = proxy_url
    if not str(env.get("all_proxy", "") or "").strip():
        env["all_proxy"] = proxy_url
    if not str(env.get("NO_PROXY", "") or "").strip():
        env["NO_PROXY"] = "localhost,127.0.0.1,::1"
    if not str(env.get("no_proxy", "") or "").strip():
        env["no_proxy"] = "localhost,127.0.0.1,::1"
    return env


def _get_selected_reasoning_effort(cfg):
    mode = str(cfg.get("mode", "") or "").strip().lower()
    if mode == "gemini":
        return _normalize_reasoning_effort(cfg.get("gemini_reasoning_effort", "medium"))
    if mode == "claude":
        return _normalize_reasoning_effort(cfg.get("claude_reasoning_effort", "medium"))
    if mode == "doubao":
        return _normalize_reasoning_effort(cfg.get("doubao_reasoning_effort", "medium"))
    return _normalize_reasoning_effort(cfg.get("codex_reasoning_effort", "medium"))


def _with_reasoning_instruction(prompt, cfg):
    effort = _get_selected_reasoning_effort(cfg)
    if effort == "high":
        level = "高"
        instruction = "优先严谨推理与连贯性，允许更充分的思考后再输出。"
    elif effort == "low":
        level = "低"
        instruction = "优先响应速度，减少过度推演，保持基本连贯与可读性。"
    else:
        level = "中"
        instruction = "在速度与推理深度之间平衡，确保连贯与质量。"

    prefix = f"【思考等级】{level}（{effort}）\n{instruction}\n\n"
    return f"{prefix}{prompt}"


def _apply_reasoning_override(cfg, effort_override=None):
    effort = str(effort_override or "").strip().lower()
    if not effort:
        return cfg
    effort = _normalize_reasoning_effort(effort)
    next_cfg = dict(cfg or {})
    mode = str(next_cfg.get("mode", "") or "").strip().lower()
    if mode == "gemini":
        next_cfg["gemini_reasoning_effort"] = effort
    elif mode == "claude":
        next_cfg["claude_reasoning_effort"] = effort
    elif mode == "doubao":
        next_cfg["doubao_reasoning_effort"] = effort
    else:
        next_cfg["codex_reasoning_effort"] = effort
    return next_cfg


def _quote_ps_arg(value):
    # Escape for PowerShell double-quoted argument.
    s = str(value or "")
    s = s.replace("`", "``").replace('"', '`"')
    return f'"{s}"'


def _normalize_api_url(base_url):
    url = (base_url or "").strip()
    if not url:
        return ""
    url = url.rstrip("/")
    if re.search(r"/chat/completions$", url, flags=re.IGNORECASE):
        return url
    if re.search(r"/v1$", url, flags=re.IGNORECASE):
        return f"{url}/chat/completions"
    return f"{url}/v1/chat/completions"


def _normalize_api_responses_url(base_url):
    url = (base_url or "").strip()
    if not url:
        return ""
    url = url.rstrip("/")
    if re.search(r"/responses$", url, flags=re.IGNORECASE):
        return url
    if re.search(r"/chat/completions$", url, flags=re.IGNORECASE):
        return re.sub(r"/chat/completions$", "/responses", url, flags=re.IGNORECASE)
    if re.search(r"/v1$", url, flags=re.IGNORECASE):
        return f"{url}/responses"
    return f"{url}/v1/responses"


def _compact_base_url(base_url):
    url = str(base_url or "").strip()
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    path = re.sub(r"/{2,}", "/", parsed.path or "")
    compact = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment)
    )
    return compact.rstrip("/")


def _normalize_personal_chat_url(base_url):
    url = _compact_base_url(base_url)
    if not url:
        return ""
    if re.search(r"/chat/completions$", url, flags=re.IGNORECASE):
        return url
    if re.search(r"/v1$", url, flags=re.IGNORECASE):
        return f"{url}/chat/completions"
    return f"{url}/v1/chat/completions"


def _parse_personal_models(models_text, preferred_model=""):
    raw = str(models_text or "").replace("\r\n", "\n").replace("\r", "\n").replace(",", "\n")
    items = []
    seen = set()
    for line in raw.split("\n"):
        model = str(line or "").strip()
        if not model:
            continue
        key = model.casefold()
        if key in seen:
            continue
        seen.add(key)
        items.append(model)

    if not items:
        preferred = str(preferred_model or "").strip()
        items = [preferred or _PERSONAL_DEFAULT_MODEL]
    return items


def _parse_doubao_models(models_text, preferred_model=""):
    raw = str(models_text or "").replace("\r\n", "\n").replace("\r", "\n").replace(",", "\n")
    items = []
    seen = set()
    for line in raw.split("\n"):
        model = str(line or "").strip()
        if not model:
            continue
        key = model.casefold()
        if key in seen:
            continue
        seen.add(key)
        items.append(model)

    preferred = str(preferred_model or "").strip()
    if preferred and preferred.casefold() not in {x.casefold() for x in items}:
        items.insert(0, preferred)
    if not items:
        items = list(_DOUBAO_MODEL_FALLBACKS)
    return items


def _normalize_wire_api(value):
    x = str(value or "").strip().lower()
    if x == "chat_completions":
        x = "chat"
    if x in {"responses", "chat"}:
        return x
    return "auto"


def _normalize_api_key(value):
    key = str(value or "").strip()
    if key.lower() in {"apikey", "your_api_key", "your-api-key"}:
        return ""
    return key


def _read_named_api_key(auth_path, key_names):
    """从指定路径或自动查找配置文件读取API密钥"""
    # 如果提供了路径，先尝试该路径
    if auth_path:
        p = pathlib.Path(auth_path)
        if p.exists():
            try:
                with p.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    for key_name in key_names:
                        value = _normalize_api_key(data.get(key_name, ""))
                        if value:
                            return value
            except Exception:
                pass
    
    # 自动在多个路径中查找 auth.json
    auth_file = _find_config_file("auth.json")
    if auth_file:
        try:
            with open(auth_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for key_name in key_names:
                    value = _normalize_api_key(data.get(key_name, ""))
                    if value:
                        return value
        except Exception:
            pass
    
    return ""


def _read_auth_api_key(auth_path):
    """读取通用API密钥（OpenAI格式）"""
    return _read_named_api_key(auth_path, ("OPENAI_API_KEY",))


def _load_project_api_config():
    """加载项目API配置（从model_api.toml）"""
    if tomllib is None:
        return None
    
    # 在多个路径中查找 model_api.toml
    config_file = _find_config_file("model_api.toml")
    if not config_file:
        return None

    try:
        with open(config_file, "rb") as f:
            cfg = tomllib.load(f)
    except Exception:
        return None

    if not isinstance(cfg, dict):
        return None

    provider_name = str(cfg.get("model_provider", "") or "").strip()
    providers = cfg.get("model_providers", {})
    provider_cfg = {}
    if isinstance(providers, dict) and provider_name:
        x = providers.get(provider_name, {})
        if isinstance(x, dict):
            provider_cfg = x

    preferred_auth_method = str(cfg.get("preferred_auth_method", "") or "").strip().lower()
    auth_api_key = _read_auth_api_key(_PROJECT_API_AUTH_PATH)
    direct_api_key = _normalize_api_key(cfg.get("api_key", ""))
    if preferred_auth_method == "apikey":
        api_key = auth_api_key or direct_api_key
    else:
        api_key = auth_api_key or direct_api_key

    base_url = (
        str(provider_cfg.get("base_url", "") or "").strip()
        or str(cfg.get("base_url", "") or "").strip()
    )
    wire_api = _normalize_wire_api(
        provider_cfg.get("wire_api", "") or cfg.get("wire_api", "")
    )
    reasoning_effort = (
        str(cfg.get("model_reasoning_effort", "") or "").strip().lower()
        or str(cfg.get("reasoning_effort", "") or "").strip().lower()
    )

    has_disable_response_storage = "disable_response_storage" in cfg
    disable_response_storage = None
    if has_disable_response_storage:
        disable_response_storage = bool(cfg.get("disable_response_storage"))

    return {
        "model": str(cfg.get("model", "") or "").strip(),
        "base_url": base_url,
        "api_key": api_key,
        "wire_api": wire_api,
        "reasoning_effort": reasoning_effort,
        "disable_response_storage": disable_response_storage,
        "has_disable_response_storage": has_disable_response_storage,
        "model_provider": provider_name,
        "preferred_auth_method": preferred_auth_method,
        "auth_path": str(_PROJECT_API_AUTH_PATH),
        "config_path": str(_PROJECT_API_CONFIG_PATH),
    }


def _load_codex_model_api_config():
    if tomllib is None:
        return None
    codex_home = os.environ.get("CODEX_HOME", "").strip()
    if not codex_home:
        codex_home = str(pathlib.Path.home() / ".codex")

    model_dir = pathlib.Path(codex_home) / "model"
    toml_path = model_dir / "config.toml"
    auth_path = model_dir / "auth.json"
    if not toml_path.exists():
        return None

    try:
        with toml_path.open("rb") as f:
            cfg = tomllib.load(f)
    except Exception:
        return None

    if not isinstance(cfg, dict):
        return None

    provider_name = str(cfg.get("model_provider", "") or "").strip()
    providers = cfg.get("model_providers", {})
    provider_cfg = {}
    if isinstance(providers, dict) and provider_name:
        x = providers.get(provider_name, {})
        if isinstance(x, dict):
            provider_cfg = x

    auth_key = _read_auth_api_key(auth_path)

    return {
        "model_provider": provider_name,
        "model": str(cfg.get("model", "") or "").strip(),
        "base_url": str(provider_cfg.get("base_url", "") or "").strip(),
        "wire_api": _normalize_wire_api(provider_cfg.get("wire_api", "")),
        "reasoning_effort": str(cfg.get("model_reasoning_effort", "") or "").strip().lower(),
        "disable_response_storage": bool(cfg.get("disable_response_storage", False)),
        "auth_api_key": _normalize_api_key(auth_key),
        "config_path": str(toml_path),
        "auth_path": str(auth_path),
    }


def _resolve_api_runtime_config(cfg):
    project_cfg = _load_project_api_config() or {}
    provider = _load_codex_model_api_config() or {}

    source = "none"
    config_path = ""

    if project_cfg:
        source = "project_file"
        config_path = str(project_cfg.get("config_path", "") or "")
    elif provider:
        source = "codex_model"
        config_path = str(provider.get("config_path", "") or "")

    base_url = (
        project_cfg.get("base_url")
        or cfg.get("api_base_url", "")
        or provider.get("base_url", "")
    )
    model = (
        project_cfg.get("model")
        or cfg.get("api_model", "")
        or provider.get("model", "")
    )

    api_key = _normalize_api_key(project_cfg.get("api_key", ""))
    if not api_key:
        api_key = _normalize_api_key(provider.get("auth_api_key", ""))
    if not api_key:
        api_key = _normalize_api_key(os.environ.get("OPENAI_API_KEY", ""))

    wire_api = _normalize_wire_api(project_cfg.get("wire_api", ""))
    if wire_api == "auto":
        wire_api = _normalize_wire_api(provider.get("wire_api", ""))

    reasoning_effort = (
        str(project_cfg.get("reasoning_effort", "") or "").strip().lower()
        or str(provider.get("reasoning_effort", "") or "").strip().lower()
    )

    disable_response_storage = provider.get("disable_response_storage", False)
    if project_cfg.get("has_disable_response_storage"):
        disable_response_storage = bool(project_cfg.get("disable_response_storage"))

    return {
        "base_url": str(base_url).strip(),
        "api_key": str(api_key).strip(),
        "model": str(model).strip(),
        "wire_api": wire_api,
        "reasoning_effort": reasoning_effort,
        "disable_response_storage": bool(disable_response_storage),
        "provider_loaded": bool(provider),
        "project_file_loaded": bool(project_cfg),
        "source": source,
        "config_path": config_path,
    }


def _is_retryable_transport_exception(exc):
    if _is_transport_error(exc):
        return True

    if isinstance(
        exc,
        (
            http.client.RemoteDisconnected,
            ConnectionResetError,
            ConnectionAbortedError,
            TimeoutError,
            socket.timeout,
            ssl.SSLError,
            urllib.error.URLError,
        ),
    ):
        return True

    reason = getattr(exc, "reason", None)
    text = str(reason or exc).lower()
    markers = (
        "remote end closed connection without response",
        "server disconnected",
        "connection aborted",
        "connection reset",
        "unexpected_eof_while_reading",
        "eof occurred in violation of protocol",
        "timed out",
        "temporarily unavailable",
    )
    return any(marker in text for marker in markers)


def _http_post_json_with_headers(url, payload, headers=None, timeout_seconds=None, retries=2, disable_proxy=False):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "NNovel/1.0 (+python-urllib)")
    req.add_header("Connection", "close")
    if isinstance(headers, dict):
        for key, value in headers.items():
            if not key:
                continue
            req.add_header(str(key), str(value))

    ctx = ssl.create_default_context()
    # Some third-party gateways are unstable on TLS negotiation; pinning to TLS1.2+ helps.
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    except Exception:
        pass

    timeout = timeout_seconds if timeout_seconds is not None else CODEX_TIMEOUT
    max_attempts = max(1, int(retries))
    last_error = None
    for attempt in range(max_attempts):
        try:
            if disable_proxy:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler({}),
                    urllib.request.HTTPHandler(),
                    urllib.request.HTTPSHandler(context=ctx),
                )
                with opener.open(req, timeout=timeout) as resp:
                    return resp.read().decode("utf-8", errors="replace")
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            last_error = e
            if _is_retryable_transport_exception(e) and attempt < max_attempts - 1:
                # Exponential backoff, capped to avoid long stall on flaky links.
                time.sleep(min(1.6, 0.35 * (2 ** attempt)))
                continue
            raise
    if last_error:
        raise last_error
    raise RuntimeError("http request failed")


def _http_post_json(url, payload, api_key, timeout_seconds=None, retries=2, disable_proxy=False):
    headers = {"Authorization": f"Bearer {api_key}"}
    return _http_post_json_with_headers(
        url,
        payload,
        headers=headers,
        timeout_seconds=timeout_seconds,
        retries=retries,
        disable_proxy=disable_proxy,
    )


def _extract_chat_content(data):
    if not isinstance(data, dict):
        return ""
    content = ""
    choices = data.get("choices") or []
    if choices and isinstance(choices, list):
        first = choices[0] or {}
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                content = msg.get("content", "") or ""
            if not content:
                content = first.get("text", "") or ""
    if not content:
        content = data.get("output_text", "") or ""
    return content or ""


def _extract_chat_stream_delta(event):
    if not isinstance(event, dict):
        return ""
    choices = event.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] or {}
    if not isinstance(first, dict):
        return ""

    delta = first.get("delta")
    if isinstance(delta, dict):
        content = delta.get("content", "")
        if isinstance(content, str) and content:
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text", "")
                    if isinstance(text, str) and text:
                        parts.append(text)
            if parts:
                return "".join(parts)
    elif isinstance(delta, str) and delta:
        return delta
    return ""


def _read_named_auth_value(auth_path, key_names):
    if auth_path:
        p = pathlib.Path(auth_path)
        if p.exists():
            try:
                with p.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    for key_name in key_names:
                        value = str(data.get(key_name, "") or "").strip()
                        if value:
                            return value
            except Exception:
                pass

    auth_file = _find_config_file("auth.json")
    if auth_file:
        try:
            with open(auth_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for key_name in key_names:
                    value = str(data.get(key_name, "") or "").strip()
                    if value:
                        return value
        except Exception:
            pass
    return ""


def _extract_responses_content(data):
    if not isinstance(data, dict):
        return ""
    content = data.get("output_text", "") or ""
    if content:
        return content

    output = data.get("output")
    if not isinstance(output, list):
        return ""

    parts = []
    for item in output:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "message":
            continue
        item_content = item.get("content")
        if not isinstance(item_content, list):
            continue
        for c in item_content:
            if not isinstance(c, dict):
                continue
            ctype = str(c.get("type", "")).lower()
            if ctype in {"output_text", "text"}:
                text = c.get("text", "")
                if text:
                    parts.append(str(text))
    return "\n".join(parts).strip()


def _extract_gemini_content(data):
    if not isinstance(data, dict):
        return ""
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        return ""
    pieces = []
    for cand in candidates:
        if not isinstance(cand, dict):
            continue
        content = cand.get("content")
        if not isinstance(content, dict):
            continue
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            text = part.get("text", "")
            if isinstance(text, str) and text:
                pieces.append(text)
    return "".join(pieces).strip()


def _extract_claude_content(data):
    if not isinstance(data, dict):
        return ""
    content = data.get("content")
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if str(item.get("type", "")).lower() != "text":
            continue
        text = item.get("text", "")
        if isinstance(text, str) and text:
            parts.append(text)
    return "".join(parts).strip()


def _resolve_codex_api_key(cfg):
    override = _normalize_api_key((cfg or {}).get("codex_api_key", ""))
    if override:
        return override
    key = _read_named_api_key(None, ("OPENAI_API_KEY",))
    if key:
        return key
    return _normalize_api_key(os.environ.get("OPENAI_API_KEY", ""))


def _resolve_gemini_api_key(cfg):
    override = _normalize_api_key((cfg or {}).get("gemini_api_key", ""))
    if override:
        return override
    key = _read_named_api_key(None, ("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    if key:
        return key
    key = _normalize_api_key(os.environ.get("GEMINI_API_KEY", ""))
    if key:
        return key
    key = _normalize_api_key(os.environ.get("GOOGLE_API_KEY", ""))
    if key:
        return key
    return ""


def _resolve_claude_api_key(cfg):
    override = _normalize_api_key((cfg or {}).get("claude_api_key", ""))
    if override:
        return override
    key = _read_named_api_key(None, ("ANTHROPIC_API_KEY",))
    if key:
        return key
    return _normalize_api_key(os.environ.get("ANTHROPIC_API_KEY", ""))


def _resolve_personal_api_key(cfg):
    override = _normalize_api_key((cfg or {}).get("personal_api_key", ""))
    if override:
        return override
    key = _read_named_api_key(None, ("PERSONAL_API_KEY", "OPENAI_API_KEY"))
    if key:
        return key
    key = _normalize_api_key(os.environ.get("PERSONAL_API_KEY", ""))
    if key:
        return key
    return _normalize_api_key(os.environ.get("OPENAI_API_KEY", ""))


def _resolve_personal_base_url(cfg):
    override = str((cfg or {}).get("personal_base_url", "") or "").strip()
    if override:
        return override
    url = _read_named_auth_value(None, ("PERSONAL_BASE_URL",))
    if url:
        return url
    return str(os.environ.get("PERSONAL_BASE_URL", "") or "").strip()


def _claude_api_model_candidates(model_alias):
    alias = _normalize_claude_model(model_alias)
    mapping = {
        "opus": [
            "claude-opus-4-1-20250805",
            "claude-opus-4-1",
            "claude-opus-4",
            "claude-opus-latest",
        ],
        "sonnet": [
            "claude-sonnet-4-5-20250929",
            "claude-sonnet-4-5",
            "claude-3-7-sonnet-latest",
            "claude-3-5-sonnet-latest",
        ],
        "haiku": [
            "claude-haiku-4-5-20251001",
            "claude-haiku-4-5",
            "claude-3-5-haiku-latest",
        ],
    }
    items = [alias]
    items.extend(mapping.get(alias, []))
    out = []
    seen = set()
    for item in items:
        value = str(item or "").strip()
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out or ["sonnet"]


def _call_codex_official_api(prompt, cfg=None):
    cfg = cfg or _get_engine_config()
    model = str(cfg.get("codex_model", "") or "").strip() or "gpt-5.1-codex-mini"
    api_key = _resolve_codex_api_key(cfg)
    if not api_key:
        return False, "", "ChatGPT API 模式需要 OPENAI_API_KEY（或在设置中填写 API Key）"

    base_url = "https://api.openai.com/v1"
    responses_url = f"{base_url}/responses"
    chat_url = f"{base_url}/chat/completions"
    responses_payload = {"model": model, "input": prompt}
    effort = _normalize_reasoning_effort(cfg.get("codex_reasoning_effort", "medium"))
    if effort:
        responses_payload["reasoning"] = {"effort": effort}
    chat_payload = {"model": model, "messages": [{"role": "user", "content": prompt}]}

    attempts = [
        ("responses", responses_url, responses_payload),
        ("chat", chat_url, chat_payload),
    ]
    errors = []
    for idx, (kind, url, payload) in enumerate(attempts):
        _runtime_mark_attempt("codex", model)
        started = time.monotonic()
        try:
            raw = _http_post_json(url, payload, api_key, timeout_seconds=CODEX_TIMEOUT, retries=2)
            data = json.loads(raw)
            content = _extract_responses_content(data) if kind == "responses" else _extract_chat_content(data)
            if content:
                total_ms = (time.monotonic() - started) * 1000.0
                _runtime_mark_success("codex", model, failover=idx > 0, total_ms=total_ms, first_token_ms=total_ms)
                return True, content, None
            errors.append(f"chatgpt {kind} 返回内容为空")
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("codex", model, "empty content", total_ms=total_ms, first_token_ms=total_ms)
        except urllib.error.HTTPError as e:
            body = _safe_error_body(e)
            errors.append(f"chatgpt {kind} http {e.code}: {body[:220]}")
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("codex", model, f"http {e.code}", total_ms=total_ms, first_token_ms=total_ms)
        except Exception as e:
            errors.append(f"chatgpt {kind} error: {e}")
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("codex", model, str(e), total_ms=total_ms)
    return False, "", " | ".join(errors) if errors else "chatgpt api 调用失败"


def _call_gemini_official_api(prompt, cfg=None):
    cfg = cfg or _get_engine_config()
    model = str(cfg.get("gemini_model", "") or "").strip() or "gemini-2.5-flash"
    api_key = _resolve_gemini_api_key(cfg)
    if not api_key:
        return False, "", "Gemini API 模式需要 GEMINI_API_KEY（或在设置中填写 API Key）"

    model_path = urllib.parse.quote(model, safe="")
    key_q = urllib.parse.quote(api_key, safe="")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_path}:generateContent?key={key_q}"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ]
    }
    _runtime_mark_attempt("gemini", model)
    started = time.monotonic()
    try:
        raw = _http_post_json_with_headers(url, payload, headers={}, timeout_seconds=GEMINI_TIMEOUT, retries=2)
        data = json.loads(raw)
        content = _extract_gemini_content(data)
        if content:
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_success("gemini", model, total_ms=total_ms, first_token_ms=total_ms)
            return True, content, None
        total_ms = (time.monotonic() - started) * 1000.0
        _runtime_mark_error("gemini", model, "empty content", total_ms=total_ms, first_token_ms=total_ms)
        return False, "", "gemini api 返回内容为空"
    except urllib.error.HTTPError as e:
        body = _safe_error_body(e)
        total_ms = (time.monotonic() - started) * 1000.0
        _runtime_mark_error("gemini", model, f"http {e.code}", total_ms=total_ms, first_token_ms=total_ms)
        return False, "", f"gemini api http {e.code}: {body[:300]}"
    except Exception as e:
        total_ms = (time.monotonic() - started) * 1000.0
        _runtime_mark_error("gemini", model, str(e), total_ms=total_ms)
        return False, "", f"gemini api error: {e}"


def _call_claude_official_api(prompt, cfg=None):
    cfg = cfg or _get_engine_config()
    alias = _normalize_claude_model(cfg.get("claude_model", "sonnet"))
    api_key = _resolve_claude_api_key(cfg)
    if not api_key:
        return False, "", "Claude API 模式需要 ANTHROPIC_API_KEY（或在设置中填写 API Key）"

    url = "https://api.anthropic.com/v1/messages"
    candidates = _claude_api_model_candidates(alias)
    errors = []
    for idx, model in enumerate(candidates):
        _runtime_mark_attempt("claude", model)
        started = time.monotonic()
        payload = {
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        }
        try:
            raw = _http_post_json_with_headers(
                url,
                payload,
                headers=headers,
                timeout_seconds=GEMINI_TIMEOUT,
                retries=2,
            )
            data = json.loads(raw)
            content = _extract_claude_content(data)
            if content:
                total_ms = (time.monotonic() - started) * 1000.0
                _runtime_mark_success(
                    "claude",
                    model,
                    failover=idx > 0,
                    total_ms=total_ms,
                    first_token_ms=total_ms,
                )
                return True, content, None
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("claude", model, "empty content", total_ms=total_ms, first_token_ms=total_ms)
            errors.append(f"claude 返回内容为空（model={model}）")
        except urllib.error.HTTPError as e:
            body = _safe_error_body(e)
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("claude", model, f"http {e.code}", total_ms=total_ms, first_token_ms=total_ms)
            errors.append(f"claude http {e.code}（model={model}）: {body[:220]}")
        except Exception as e:
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("claude", model, str(e), total_ms=total_ms)
            errors.append(f"claude error（model={model}）: {e}")
    return False, "", " | ".join(errors) if errors else "claude api 调用失败"


def _call_selected_engine_api(prompt, cfg=None):
    cfg = cfg or _get_engine_config()
    mode = str(cfg.get("mode", "") or "").strip().lower()
    if mode == "codex":
        return _call_codex_official_api(prompt, cfg=cfg)
    if mode == "gemini":
        return _call_gemini_official_api(prompt, cfg=cfg)
    if mode == "claude":
        return _call_claude_official_api(prompt, cfg=cfg)
    return False, "", f"不支持的 API 模式引擎：{mode}"


def _extract_text_from_content_blocks(blocks):
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        return ""

    parts = []
    for item in blocks:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        text = item.get("text", "")
        if isinstance(text, str) and text:
            parts.append(text)
    return "".join(parts).strip()


def _extract_stream_text_from_event(event):
    if not isinstance(event, dict):
        return "", ""

    event_type = str(event.get("type", "") or "").lower()
    if "reasoning" in event_type or "summary" in event_type:
        return "", ""
    if event_type in {"error", "turn.started", "turn.failed", "thread.started", "init"}:
        return "", ""

    delta_parts = []
    full_parts = []

    delta = event.get("delta")
    if isinstance(delta, str) and delta:
        delta_parts.append(delta)
    elif isinstance(delta, dict):
        for key in ("text", "output_text", "content"):
            value = delta.get(key)
            if isinstance(value, str) and value:
                delta_parts.append(value)

    for key in ("text", "output_text", "response"):
        value = event.get(key)
        if isinstance(value, str) and value:
            full_parts.append(value)

    message = event.get("message")
    if isinstance(message, dict):
        role = str(message.get("role", "") or "").lower()
        if role in {"assistant", "model"}:
            content_text = _extract_text_from_content_blocks(message.get("content"))
            if content_text:
                full_parts.append(content_text)

    content = event.get("content")
    content_text = _extract_text_from_content_blocks(content)
    if content_text:
        full_parts.append(content_text)

    cb_delta = event.get("content_block_delta")
    if isinstance(cb_delta, dict):
        cb_text = cb_delta.get("text", "")
        if isinstance(cb_text, str) and cb_text:
            delta_parts.append(cb_text)

    cb = event.get("content_block")
    if isinstance(cb, dict):
        cb_text = cb.get("text", "")
        if isinstance(cb_text, str) and cb_text:
            full_parts.append(cb_text)

    out_chat = _extract_chat_content(event)
    if out_chat:
        full_parts.append(out_chat)
    out_resp = _extract_responses_content(event)
    if out_resp:
        full_parts.append(out_resp)

    delta_text = "".join([p for p in delta_parts if p]).strip()
    full_text = "\n".join([p for p in full_parts if p]).strip()
    return delta_text, full_text


def _extract_stream_text(raw_text):
    text = str(raw_text or "")
    if not text:
        return ""

    delta_chunks = []
    latest_full = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("data:"):
            line = line[5:].strip()
        if not line or line == "[DONE]":
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue

        delta_text, full_text = _extract_stream_text_from_event(obj)
        if delta_text:
            delta_chunks.append(delta_text)
        if full_text:
            latest_full = full_text

    if delta_chunks:
        return "".join(delta_chunks).strip()
    return latest_full


def _normalize_command_output(raw_text, parse_stream_json=False):
    raw = str(raw_text or "")
    if parse_stream_json:
        parsed = _extract_stream_text(raw)
        if not parsed:
            return ""
        raw = parsed
    return _clean_generated_text(raw)


def _extract_first_json_object(text):
    raw = str(text or "").strip()
    if not raw:
        return ""

    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()

    start = raw.find("{")
    if start < 0:
        return ""
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(raw)):
        ch = raw[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start:i + 1]
    return ""


def _is_transport_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return False
    if isinstance(exc, urllib.error.URLError):
        reason = getattr(exc, "reason", None)
        if isinstance(reason, (ssl.SSLError, socket.timeout)):
            return True
        text = str(reason or exc).lower()
        markers = (
            "unexpected_eof_while_reading",
            "eof occurred in violation of protocol",
            "connection reset",
            "timed out",
            "temporary failure",
            "name resolution",
            "failed to establish a new connection",
        )
        return any(m in text for m in markers)
    text = str(exc).lower()
    return "ssl" in text or "eof" in text


def _call_api(prompt):
    cfg = _get_engine_config()
    resolved = _resolve_api_runtime_config(cfg)
    base_url = resolved["base_url"]
    api_key = resolved["api_key"]
    api_model = resolved["model"]
    wire_api = resolved["wire_api"]
    if not base_url or not api_key or not api_model:
        config_path = resolved.get("config_path", "")
        if not config_path:
            config_path = str(_PROJECT_API_CONFIG_PATH)
        return (
            False,
            "",
            f"api 模式需要提供 base url、api key 和模型（建议编辑 {config_path}）",
        )

    chat_url = _normalize_api_url(base_url)
    responses_url = _normalize_api_responses_url(base_url)
    if not chat_url or not responses_url:
        return False, "", "api base url 无效"

    responses_payload = {
        "model": api_model,
        "input": prompt,
    }
    if resolved["reasoning_effort"]:
        responses_payload["reasoning"] = {"effort": resolved["reasoning_effort"]}
    if resolved["disable_response_storage"]:
        responses_payload["store"] = False

    chat_payload = {
        "model": api_model,
        "messages": [{"role": "user", "content": prompt}],
    }

    if wire_api == "responses":
        attempts = [
            ("responses", responses_url, responses_payload),
            ("chat", chat_url, chat_payload),
        ]
    elif wire_api == "chat":
        attempts = [
            ("chat", chat_url, chat_payload),
            ("responses", responses_url, responses_payload),
        ]
    else:
        attempts = [
            ("chat", chat_url, chat_payload),
            ("responses", responses_url, responses_payload),
        ]

    errors = []
    for idx, (kind, url, payload) in enumerate(attempts):
        _runtime_mark_attempt("api", api_model)
        try:
            raw = _http_post_json(url, payload, api_key)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            errors.append(f"api {kind} http {e.code} url={url} model={api_model}: {body[:500]}")
            _runtime_mark_error("api", api_model, f"http {e.code}")
            # Explicit wire_api with business-layer HTTP errors should not silently fall back.
            if wire_api in {"chat", "responses"}:
                break
            continue
        except Exception as e:
            errors.append(f"api {kind} error url={url} model={api_model}: {e}")
            _runtime_mark_error("api", api_model, str(e))
            # For explicit wire_api, only fallback on transport-layer failures.
            if wire_api in {"chat", "responses"} and (idx == 0) and _is_transport_error(e):
                continue
            if wire_api in {"chat", "responses"}:
                break
            continue

        try:
            data = json.loads(raw)
        except Exception:
            errors.append(f"api {kind} response 不是有效 JSON")
            if wire_api in {"chat", "responses"}:
                break
            continue

        content = _extract_responses_content(data) if kind == "responses" else _extract_chat_content(data)
        if not content:
            # Fallback extraction for non-standard wrappers.
            content = _extract_chat_content(data) or _extract_responses_content(data)
        if content:
            _runtime_mark_success("api", api_model, failover=idx > 0)
            return True, content, None
        errors.append(f"api {kind} response 为空")
        _runtime_mark_error("api", api_model, "empty content")
        if wire_api in {"chat", "responses"}:
            break

    _runtime_mark_error("api", api_model, "all attempts failed")
    return False, "", " | ".join(errors) if errors else "api 未知错误"


def _resolve_personal_runtime_config(cfg):
    base_url = _normalize_personal_chat_url(_resolve_personal_base_url(cfg))
    api_key = _resolve_personal_api_key(cfg)
    models = _parse_personal_models(
        cfg.get("personal_models", ""),
        str(cfg.get("personal_model", "") or "").strip() or _PERSONAL_DEFAULT_MODEL,
    )
    model = models[0] if models else _PERSONAL_DEFAULT_MODEL
    return {
        "chat_url": base_url,
        "api_key": api_key,
        "model": model,
        "models": models,
    }


def _call_personal(prompt):
    cfg = _get_engine_config()
    resolved = _resolve_personal_runtime_config(cfg)
    chat_url = resolved["chat_url"]
    api_key = resolved["api_key"]
    model = resolved["model"]
    models = _rank_models_for_failover("personal", resolved.get("models") or [model])

    if not chat_url or not api_key:
        return False, "", "个人配置模式需要填写 base url 和 api key"

    errors = []
    for idx, current_model in enumerate(models):
        started = time.monotonic()
        _runtime_mark_attempt("personal", current_model)
        payload = {
            "model": current_model,
            "messages": [{"role": "user", "content": prompt}],
        }
        try:
            raw = _http_post_json(
                chat_url,
                payload,
                api_key,
                timeout_seconds=CODEX_TIMEOUT,
                retries=3,
                disable_proxy=True,
            )
        except urllib.error.HTTPError as e:
            body = _safe_error_body(e)
            errors.append(f"personal chat http {e.code} model={current_model}: {body[:220]}")
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("personal", current_model, f"http {e.code}", total_ms=total_ms, first_token_ms=total_ms)
            continue
        except Exception as e:
            errors.append(f"personal chat error model={current_model}: {e}")
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("personal", current_model, str(e), total_ms=total_ms)
            continue

        try:
            data = json.loads(raw)
        except Exception:
            errors.append(f"personal chat 返回不是有效 JSON（model={current_model}）")
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("personal", current_model, "invalid json", total_ms=total_ms)
            continue

        content = _extract_chat_content(data) or _extract_responses_content(data)
        if content:
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_success(
                "personal",
                current_model,
                failover=idx > 0,
                total_ms=total_ms,
                first_token_ms=total_ms,
            )
            return True, content, None
        errors.append(f"personal chat 返回内容为空（model={current_model}）")
        total_ms = (time.monotonic() - started) * 1000.0
        _runtime_mark_error("personal", current_model, "empty content", total_ms=total_ms)

    return False, "", " | ".join(errors) if errors else f"personal chat error url={chat_url} model={model}: 未知错误"


def _call_personal_with_progress(prompt, on_progress=None, should_stop=None):
    cfg = _get_engine_config()
    resolved = _resolve_personal_runtime_config(cfg)
    chat_url = resolved["chat_url"]
    api_key = resolved["api_key"]
    model = resolved["model"]
    models = _rank_models_for_failover("personal", resolved.get("models") or [model])

    if not chat_url or not api_key:
        return False, "", "个人配置模式需要填写 base url 和 api key"

    start_time = time.monotonic()
    last_thinking = ""
    progress_state = {"partial_len": 0}
    progress_stop = threading.Event()

    def _emit_thinking(force=False):
        nonlocal last_thinking
        if not on_progress:
            return
        thinking = _select_thinking_text(
            time.monotonic() - start_time,
            int(progress_state.get("partial_len", 0)),
        )
        if force or thinking != last_thinking:
            last_thinking = thinking
            on_progress("", thinking)

    def _thinking_worker():
        while not progress_stop.wait(0.8):
            if should_stop and should_stop():
                break
            _emit_thinking(force=False)

    progress_thread = None
    if on_progress:
        _emit_thinking(force=True)
        progress_thread = threading.Thread(target=_thinking_worker, daemon=True)
        progress_thread.start()

    tried = []
    retries = max(1, min(5, int(os.environ.get("PERSONAL_API_RETRIES", "3"))))
    last_err = ""

    try:
        for idx, current_model in enumerate(models):
            model_started = time.monotonic()
            first_token_ms = None
            _runtime_mark_attempt("personal", current_model)
            tried.append(current_model)
            payload = {
                "model": current_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            }
            req_data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

            for attempt in range(retries):
                req = urllib.request.Request(chat_url, data=req_data, method="POST")
                req.add_header("Content-Type", "application/json")
                req.add_header("Accept", "text/event-stream")
                req.add_header("Authorization", f"Bearer {api_key}")
                req.add_header("Connection", "close")
                req.add_header("User-Agent", "NNovel/1.0 (+python-urllib)")

                ctx = ssl.create_default_context()
                try:
                    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
                except Exception:
                    pass

                try:
                    opener = urllib.request.build_opener(
                        urllib.request.ProxyHandler({}),
                        urllib.request.HTTPHandler(),
                        urllib.request.HTTPSHandler(context=ctx),
                    )
                    pieces = []
                    last_partial = ""
                    with opener.open(req, timeout=CODEX_TIMEOUT) as resp:
                        for raw_line in resp:
                            if should_stop and should_stop():
                                _runtime_mark_error("personal", current_model, "stopped by user")
                                return False, "".join(pieces), "stopped by user"

                            line = raw_line.decode("utf-8", errors="replace").strip()
                            if not line:
                                continue
                            if line.startswith("data:"):
                                line = line[5:].strip()
                            if not line:
                                continue
                            if line == "[DONE]":
                                break

                            try:
                                event = json.loads(line)
                            except Exception:
                                continue

                            if isinstance(event.get("error"), dict):
                                msg = str(event["error"].get("message", "") or "unknown error")
                                last_err = f"personal chat stream error model={current_model}: {msg}"
                                break

                            delta = _extract_chat_stream_delta(event)
                            if delta:
                                pieces.append(delta)
                            else:
                                full = _extract_chat_content(event) or _extract_responses_content(event)
                                if full:
                                    pieces = [full]

                            current_text = _clean_generated_text("".join(pieces))
                            progress_state["partial_len"] = len(current_text)
                            if current_text and first_token_ms is None:
                                first_token_ms = (time.monotonic() - model_started) * 1000.0
                            if on_progress and current_text and current_text != last_partial:
                                last_partial = current_text
                                thinking = _select_thinking_text(
                                    time.monotonic() - start_time,
                                    len(current_text),
                                )
                                last_thinking = thinking
                                on_progress(current_text, thinking)

                    final_text = _clean_generated_text("".join(pieces))
                    if final_text:
                        total_ms = (time.monotonic() - model_started) * 1000.0
                        _runtime_mark_success(
                            "personal",
                            current_model,
                            failover=idx > 0,
                            total_ms=total_ms,
                            first_token_ms=first_token_ms or total_ms,
                        )
                        return True, final_text, None
                    if not last_err:
                        last_err = f"personal chat stream 内容为空（model={current_model}）"
                    total_ms = (time.monotonic() - model_started) * 1000.0
                    _runtime_mark_error(
                        "personal",
                        current_model,
                        last_err,
                        total_ms=total_ms,
                        first_token_ms=first_token_ms,
                    )
                except urllib.error.HTTPError as e:
                    body = _safe_error_body(e)
                    last_err = f"personal chat stream http {e.code} model={current_model}: {body[:300]}"
                    total_ms = (time.monotonic() - model_started) * 1000.0
                    _runtime_mark_error(
                        "personal",
                        current_model,
                        f"http {e.code}",
                        total_ms=total_ms,
                        first_token_ms=first_token_ms,
                    )
                    if e.code >= 500 and attempt < retries - 1:
                        time.sleep(min(1.6, 0.35 * (2 ** attempt)))
                        continue
                    break
                except Exception as e:
                    last_err = f"personal chat stream error model={current_model}: {e}"
                    total_ms = (time.monotonic() - model_started) * 1000.0
                    _runtime_mark_error(
                        "personal",
                        current_model,
                        str(e),
                        total_ms=total_ms,
                        first_token_ms=first_token_ms,
                    )
                    if _is_retryable_transport_exception(e) and attempt < retries - 1:
                        time.sleep(min(1.6, 0.35 * (2 ** attempt)))
                        continue
                    break

        ok, out, err = _call_personal(prompt)
        if ok:
            return True, out, None
        _runtime_mark_error("personal", model, last_err or err or "unknown error")
        return False, "", (last_err or err or f"personal chat 未知错误（models={','.join(tried) or model}）")
    finally:
        progress_stop.set()
        if progress_thread:
            progress_thread.join(timeout=0.2)


def _resolve_doubao_api_key(cfg):
    """解析豆包API密钥（支持多种来源和多路径查找）"""
    # 1. 从配置对象中获取
    key = _normalize_api_key(cfg.get("doubao_api_key", ""))
    if key:
        return key

    # 2. 从环境变量获取
    key = _normalize_api_key(os.environ.get("DOUBAO_API_KEY", ""))
    if key:
        return key

    key = _normalize_api_key(os.environ.get("ARK_API_KEY", ""))
    if key:
        return key

    # 3. 从配置文件获取（支持多路径查找）
    return _read_named_api_key(None, ("DOUBAO_API_KEY", "ARK_API_KEY"))


def _safe_error_body(err):
    try:
        return err.read().decode("utf-8", errors="replace")
    except Exception:
        return ""


def _build_doubao_403_message(last_body, models_tried):
    detail = (last_body or "").strip()
    if len(detail) > 500:
        detail = detail[:500]
    hint = "豆包返回 403 Forbidden。通常是 API Key 无权限、账号未开通该模型，或模型白名单未覆盖。"
    tried = "、".join(models_tried) if models_tried else "（无）"
    if detail:
        return f"{hint} 已尝试模型：{tried}。服务端返回：{detail}"
    return f"{hint} 已尝试模型：{tried}。"


def _is_doubao_quota_error(status_code, body_text):
    text = str(body_text or "").lower()
    if int(status_code or 0) in {402, 429}:
        return True
    markers = (
        "quota",
        "insufficient",
        "insufficient_quota",
        "insufficient_balance",
        "account_balance",
        "credit",
        "额度不足",
        "余额不足",
        "配额不足",
        "欠费",
    )
    return any(m in text for m in markers)


def _call_doubao(prompt):
    cfg = _get_engine_config()
    configured_models = _parse_doubao_models(
        cfg.get("doubao_models", ""),
        cfg.get("doubao_model", "") or _DOUBAO_DEFAULT_MODEL,
    )
    model = configured_models[0] if configured_models else _DOUBAO_DEFAULT_MODEL
    api_key = _resolve_doubao_api_key(cfg)
    if not api_key:
        return False, "", "豆包模式需要密钥：请设置 DOUBAO_API_KEY 或 ARK_API_KEY（环境变量，或写入 auth.json）"

    models_to_try = _rank_models_for_failover(
        "doubao",
        configured_models + [m for m in _DOUBAO_MODEL_FALLBACKS if m not in configured_models],
    )
    tried = []
    last_403_body = ""
    saw_403 = False
    quota_models = []
    last_error = ""

    for idx, current_model in enumerate(models_to_try):
        started = time.monotonic()
        _runtime_mark_attempt("doubao", current_model)
        tried.append(current_model)
        payload = {
            "model": current_model,
            "input": prompt,
        }
        raw = None
        transport_modes = [_DOUBAO_DISABLE_PROXY]
        if not _DOUBAO_DISABLE_PROXY:
            # Fallback to direct mode when proxy path is unstable.
            transport_modes.append(True)

        for disable_proxy in transport_modes:
            try:
                raw = _http_post_json(
                    _DOUBAO_RESPONSES_URL,
                    payload,
                    api_key,
                    timeout_seconds=_DOUBAO_HTTP_TIMEOUT,
                    retries=_DOUBAO_HTTP_RETRIES,
                    disable_proxy=disable_proxy,
                )
                break
            except urllib.error.HTTPError as e:
                body = _safe_error_body(e)
                if e.code == 403:
                    saw_403 = True
                    last_403_body = body
                    total_ms = (time.monotonic() - started) * 1000.0
                    _runtime_mark_error("doubao", current_model, "http 403 forbidden", total_ms=total_ms)
                    raw = None
                    break
                if _is_doubao_quota_error(e.code, body):
                    quota_models.append(current_model)
                    last_error = f"doubao responses quota insufficient model={current_model}: {body[:300]}"
                    total_ms = (time.monotonic() - started) * 1000.0
                    _runtime_mark_error("doubao", current_model, "quota insufficient", total_ms=total_ms)
                    raw = None
                    break
                return (
                    False,
                    "",
                    f"doubao responses http {e.code} url={_DOUBAO_RESPONSES_URL} model={current_model}: {body[:500]}",
                )
            except Exception as e:
                last_error = f"doubao responses error url={_DOUBAO_RESPONSES_URL} model={current_model}: {e}"
                total_ms = (time.monotonic() - started) * 1000.0
                _runtime_mark_error("doubao", current_model, str(e), total_ms=total_ms)
                if disable_proxy:
                    continue
                if _is_retryable_transport_exception(e):
                    continue
                break

        if raw is None:
            continue

        try:
            data = json.loads(raw)
        except Exception:
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_error("doubao", current_model, "invalid json", total_ms=total_ms)
            return False, "", f"doubao responses 返回不是有效 JSON（model={current_model}）"

        content = _extract_responses_content(data) or _extract_chat_content(data)
        if content:
            total_ms = (time.monotonic() - started) * 1000.0
            _runtime_mark_success(
                "doubao",
                current_model,
                failover=idx > 0,
                total_ms=total_ms,
                first_token_ms=total_ms,
            )
            return True, content, None
        last_error = f"doubao responses 内容为空（model={current_model}）"
        total_ms = (time.monotonic() - started) * 1000.0
        _runtime_mark_error("doubao", current_model, "empty content", total_ms=total_ms)

    if saw_403:
        return False, "", _build_doubao_403_message(last_403_body, tried)
    if quota_models and len(quota_models) == len(tried):
        return False, "", f"豆包模型额度不足，已尝试切换模型仍失败：{'、'.join(quota_models)}"
    return False, "", (last_error or f"doubao responses error url={_DOUBAO_RESPONSES_URL} model={model}: 未知错误")


def _call_doubao_with_progress(prompt, on_progress=None, should_stop=None):
    cfg = _get_engine_config()
    configured_models = _parse_doubao_models(
        cfg.get("doubao_models", ""),
        cfg.get("doubao_model", "") or _DOUBAO_DEFAULT_MODEL,
    )
    model = configured_models[0] if configured_models else _DOUBAO_DEFAULT_MODEL
    api_key = _resolve_doubao_api_key(cfg)
    if not api_key:
        return False, "", "豆包模式需要密钥：请设置 DOUBAO_API_KEY 或 ARK_API_KEY（环境变量，或写入 auth.json）"

    models_to_try = _rank_models_for_failover(
        "doubao",
        configured_models + [m for m in _DOUBAO_MODEL_FALLBACKS if m not in configured_models],
    )
    start_time = time.monotonic()
    quota_models = []
    last_err = ""
    last_thinking = ""
    progress_state = {"partial_len": 0}
    progress_stop = threading.Event()

    def _emit_thinking(force=False):
        nonlocal last_thinking
        if not on_progress:
            return
        thinking = _select_thinking_text(
            time.monotonic() - start_time,
            int(progress_state.get("partial_len", 0)),
        )
        if force or thinking != last_thinking:
            last_thinking = thinking
            on_progress("", thinking)

    def _thinking_worker():
        while not progress_stop.wait(0.8):
            if should_stop and should_stop():
                break
            _emit_thinking(force=False)

    progress_thread = None
    if on_progress:
        _emit_thinking(force=True)
        progress_thread = threading.Thread(target=_thinking_worker, daemon=True)
        progress_thread.start()

    try:
        for idx, current_model in enumerate(models_to_try):
            model_started = time.monotonic()
            first_token_ms = None
            _runtime_mark_attempt("doubao", current_model)
            payload = {
                "model": current_model,
                "input": prompt,
                "stream": True,
            }
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(_DOUBAO_RESPONSES_URL, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Accept", "text/event-stream")
            req.add_header("Authorization", f"Bearer {api_key}")
            req.add_header("Connection", "close")
            ctx = ssl.create_default_context()
            try:
                ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            except Exception:
                pass

            resp = None
            transport_modes = [_DOUBAO_DISABLE_PROXY]
            if not _DOUBAO_DISABLE_PROXY:
                transport_modes.append(True)

            for disable_proxy in transport_modes:
                try:
                    if disable_proxy:
                        opener = urllib.request.build_opener(
                            urllib.request.ProxyHandler({}),
                            urllib.request.HTTPHandler(),
                            urllib.request.HTTPSHandler(context=ctx),
                        )
                        resp = opener.open(req, timeout=_DOUBAO_HTTP_TIMEOUT)
                    else:
                        resp = urllib.request.urlopen(req, timeout=_DOUBAO_HTTP_TIMEOUT, context=ctx)
                    break
                except urllib.error.HTTPError as e:
                    body = _safe_error_body(e)
                    if e.code == 403 or _is_doubao_quota_error(e.code, body):
                        if _is_doubao_quota_error(e.code, body):
                            quota_models.append(current_model)
                        last_err = f"doubao stream http {e.code} url={_DOUBAO_RESPONSES_URL} model={current_model}: {body[:500]}"
                        total_ms = (time.monotonic() - model_started) * 1000.0
                        _runtime_mark_error(
                            "doubao",
                            current_model,
                            f"http {e.code}",
                            total_ms=total_ms,
                            first_token_ms=first_token_ms,
                        )
                        resp = None
                        break
                    return False, "", f"doubao stream http {e.code} url={_DOUBAO_RESPONSES_URL} model={current_model}: {body[:500]}"
                except Exception as e:
                    last_err = f"doubao stream error url={_DOUBAO_RESPONSES_URL} model={current_model}: {e}"
                    total_ms = (time.monotonic() - model_started) * 1000.0
                    _runtime_mark_error(
                        "doubao",
                        current_model,
                        str(e),
                        total_ms=total_ms,
                        first_token_ms=first_token_ms,
                    )
                    resp = None
                    if disable_proxy:
                        continue
                    if _is_retryable_transport_exception(e):
                        continue
                    break

            if resp is None:
                continue

            pieces = []
            last_partial = ""
            try:
                with resp:
                    for raw_line in resp:
                        if should_stop and should_stop():
                            _runtime_mark_error("doubao", current_model, "stopped by user")
                            return False, "".join(pieces), "stopped by user"
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if not line or line == "[DONE]":
                            continue
                        try:
                            event = json.loads(line)
                        except Exception:
                            continue

                        delta_text, full_text = _extract_stream_text_from_event(event)
                        if delta_text:
                            pieces.append(delta_text)
                        elif full_text:
                            merged = full_text.strip()
                            if merged:
                                pieces = [merged]

                        current_text = "".join(pieces).strip()
                        progress_state["partial_len"] = len(current_text)
                        if current_text and first_token_ms is None:
                            first_token_ms = (time.monotonic() - model_started) * 1000.0
                        if on_progress:
                            thinking = _select_thinking_text(time.monotonic() - start_time, len(current_text))
                            if current_text and current_text != last_partial:
                                last_partial = current_text
                                last_thinking = thinking
                                on_progress(_clean_generated_text(current_text), thinking)
                            elif thinking != last_thinking:
                                last_thinking = thinking
                                on_progress("", thinking)
            except Exception as e:
                last_err = f"doubao stream read error model={current_model}: {e}"
                total_ms = (time.monotonic() - model_started) * 1000.0
                _runtime_mark_error(
                    "doubao",
                    current_model,
                    str(e),
                    total_ms=total_ms,
                    first_token_ms=first_token_ms,
                )
                continue

            final_text = _clean_generated_text("".join(pieces))
            if final_text:
                total_ms = (time.monotonic() - model_started) * 1000.0
                _runtime_mark_success(
                    "doubao",
                    current_model,
                    failover=idx > 0,
                    total_ms=total_ms,
                    first_token_ms=first_token_ms or total_ms,
                )
                return True, final_text, None

        # Stream failed or produced empty output: fallback to non-stream request path.
        ok, out, err = _call_doubao(prompt)
        if ok:
            return True, out, None
        if quota_models and err:
            return False, "", err
        return False, "", (last_err or err)
    finally:
        progress_stop.set()
        if progress_thread:
            progress_thread.join(timeout=0.2)


def _build_powershell_cmd(command, args):
    ps_cmd = _resolve_powershell_cmd()
    if os.path.sep in command or (":" in command):
        safe_cmd = command.replace('"', '`"')
        cmd_expr = f'& "{safe_cmd}"'
    else:
        cmd_expr = command

    invoke = f"$p | {cmd_expr} {args}"

    script = (
        "$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
        "[Console]::InputEncoding=[Text.Encoding]::UTF8;"
        "$p=[Console]::In.ReadToEnd();"
        f"{invoke}"
    )
    return [ps_cmd, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]


def _build_engine_env(cfg):
    mode = str(cfg.get("mode", "") or "").strip().lower()
    env = os.environ.copy()
    # Gemini CLI may fail with spawn EPERM in constrained shells when it tries to relaunch itself.
    if mode == "gemini":
        env.setdefault("GEMINI_CLI_NO_RELAUNCH", "true")
    if mode == "claude":
        bash_path = _resolve_git_bash_path()
        if bash_path:
            env.setdefault("CLAUDE_CODE_GIT_BASH_PATH", bash_path)
            bash_dir = os.path.dirname(bash_path)
            if bash_dir:
                env["PATH"] = f"{bash_dir}{os.pathsep}{env.get('PATH', '')}"
    if mode in {"codex", "gemini", "claude"}:
        # Per-run temporary proxy injection for CLI subprocesses only.
        proxied = _build_cli_proxy_env(cfg)
        for k, v in proxied.items():
            env[k] = v
    return env


def _get_engine_timeout(mode):
    if mode in {"gemini", "claude"}:
        return GEMINI_TIMEOUT
    return CODEX_TIMEOUT


def get_codex_status():
    cfg = _get_engine_config()
    status = {"engine_mode": cfg["mode"]}
    runtime = _runtime_snapshot()
    status["runtime_last_engine"] = str(runtime.get("last_engine", "") or "")
    status["runtime_last_model"] = str(runtime.get("last_model", "") or "")
    status["runtime_last_error"] = str(runtime.get("last_error", "") or "")
    status["runtime_last_error_code"] = str(runtime.get("last_error_code", "") or "")
    status["runtime_attempt_total"] = int(runtime.get("attempt_total", 0) or 0)
    status["runtime_success_total"] = int(runtime.get("success_total", 0) or 0)
    status["runtime_failover_total"] = int(runtime.get("failover_total", 0) or 0)
    status["runtime_updated_at"] = float(runtime.get("updated_at", 0.0) or 0.0)
    status["model_health"] = _model_health_panel(limit=18)
    if cfg["mode"] == "api":
        resolved = _resolve_api_runtime_config(cfg)
        status["api_ready"] = bool(
            resolved["base_url"] and resolved["api_key"] and resolved["model"]
        )
        if resolved["wire_api"] == "responses":
            status["api_base_url"] = _normalize_api_responses_url(resolved["base_url"])
        else:
            status["api_base_url"] = _normalize_api_url(resolved["base_url"])
        status["api_model"] = resolved["model"]
        status["api_wire_api"] = resolved["wire_api"]
        status["api_config_source"] = resolved.get("source", "none")
        status["api_config_path"] = resolved.get("config_path", "")
    elif cfg["mode"] == "doubao":
        key = _resolve_doubao_api_key(cfg)
        doubao_models = _parse_doubao_models(
            cfg.get("doubao_models", ""),
            cfg.get("doubao_model", "") or _DOUBAO_DEFAULT_MODEL,
        )
        status["doubao_ready"] = bool(key)
        status["doubao_base_url"] = _DOUBAO_RESPONSES_URL
        status["doubao_models"] = doubao_models
        status["doubao_model"] = doubao_models[0] if doubao_models else _DOUBAO_DEFAULT_MODEL
        status["doubao_reasoning_effort"] = _get_selected_reasoning_effort(cfg)
    elif cfg["mode"] == "personal":
        resolved = _resolve_personal_runtime_config(cfg)
        status["personal_ready"] = bool(resolved["chat_url"] and resolved["api_key"])
        status["personal_base_url"] = resolved["chat_url"]
        status["personal_model"] = resolved["model"]
        status["personal_models"] = resolved.get("models", [])
        status["personal_reasoning_effort"] = _get_selected_reasoning_effort(cfg)
    else:
        if cfg["mode"] == "gemini":
            access_mode = _get_engine_runtime_access(cfg, "gemini")
            status["gemini_access_mode"] = access_mode
            status["gemini_model"] = cfg["gemini_model"]
            status["gemini_reasoning_effort"] = _get_selected_reasoning_effort(cfg)
            if access_mode == "api":
                key = _resolve_gemini_api_key(cfg)
                status["gemini_api_ready"] = bool(key)
                status["gemini_available"] = bool(key)
            else:
                path = _resolve_gemini_cmd()
                status["gemini_available"] = bool(path)
                status["gemini_path"] = path
        elif cfg["mode"] == "claude":
            access_mode = _get_engine_runtime_access(cfg, "claude")
            status["claude_access_mode"] = access_mode
            status["claude_model"] = cfg["claude_model"]
            status["claude_reasoning_effort"] = _get_selected_reasoning_effort(cfg)
            if access_mode == "api":
                key = _resolve_claude_api_key(cfg)
                status["claude_api_ready"] = bool(key)
                status["claude_available"] = bool(key)
            else:
                path = _resolve_claude_cmd()
                status["claude_available"] = bool(path)
                status["claude_path"] = path
        else:
            access_mode = _get_engine_runtime_access(cfg, "codex")
            status["codex_access_mode"] = access_mode
            status["codex_model"] = cfg["codex_model"]
            status["codex_reasoning_effort"] = _get_selected_reasoning_effort(cfg)
            if access_mode == "api":
                key = _resolve_codex_api_key(cfg)
                status["codex_api_ready"] = bool(key)
                status["codex_available"] = bool(key)
            else:
                path = _resolve_codex_cmd()
                status["codex_available"] = bool(path)
                status["codex_path"] = path
    return status


def _merge_engine_config_with_override(config_override):
    cfg = _get_engine_config()
    if not isinstance(config_override, dict):
        return cfg

    mode = str(config_override.get("engine_mode", cfg.get("mode", "codex")) or "").strip().lower()
    if mode not in {"api", "codex", "gemini", "doubao", "claude", "personal"}:
        mode = cfg.get("mode", "codex")
    cfg["mode"] = mode

    # Shared fields
    if "proxy_port" in config_override:
        cfg["proxy_port"] = _normalize_proxy_port(config_override.get("proxy_port"))
    if "codex_access_mode" in config_override:
        cfg["codex_access_mode"] = _normalize_access_mode(config_override.get("codex_access_mode"))
    if "gemini_access_mode" in config_override:
        cfg["gemini_access_mode"] = _normalize_access_mode(config_override.get("gemini_access_mode"))
    if "claude_access_mode" in config_override:
        cfg["claude_access_mode"] = _normalize_access_mode(config_override.get("claude_access_mode"))

    # API mode fields
    if "api_base_url" in config_override:
        cfg["api_base_url"] = str(config_override.get("api_base_url", "") or "").strip()
    if "api_key" in config_override:
        cfg["api_key"] = str(config_override.get("api_key", "") or "").strip()
    if "api_model" in config_override:
        cfg["api_model"] = str(config_override.get("api_model", "") or "").strip()

    # Access-mode API keys
    if "codex_api_key" in config_override:
        cfg["codex_api_key"] = str(config_override.get("codex_api_key", "") or "").strip()
    if "gemini_api_key" in config_override:
        cfg["gemini_api_key"] = str(config_override.get("gemini_api_key", "") or "").strip()
    if "claude_api_key" in config_override:
        cfg["claude_api_key"] = str(config_override.get("claude_api_key", "") or "").strip()

    # Personal mode fields
    if "personal_models" in config_override:
        cfg["personal_models"] = str(config_override.get("personal_models", "") or "").strip()
    if "personal_model" in config_override:
        cfg["personal_model"] = str(config_override.get("personal_model", "") or "").strip()
    if "personal_api_key" in config_override:
        cfg["personal_api_key"] = str(config_override.get("personal_api_key", "") or "").strip()
    if "personal_base_url" in config_override:
        cfg["personal_base_url"] = str(config_override.get("personal_base_url", "") or "").strip()

    # Per-engine models
    if "codex_model" in config_override:
        cfg["codex_model"] = str(config_override.get("codex_model", "") or "").strip()
    if "gemini_model" in config_override:
        cfg["gemini_model"] = str(config_override.get("gemini_model", "") or "").strip()
    if "claude_model" in config_override:
        cfg["claude_model"] = _normalize_claude_model(config_override.get("claude_model", ""))
    if "doubao_model" in config_override:
        cfg["doubao_model"] = str(config_override.get("doubao_model", "") or "").strip()
    if "doubao_models" in config_override:
        cfg["doubao_models"] = str(config_override.get("doubao_models", "") or "").strip()
    if "doubao_api_key" in config_override:
        cfg["doubao_api_key"] = str(config_override.get("doubao_api_key", "") or "").strip()

    return cfg


def test_engine_connectivity(config_override=None):
    cfg = _merge_engine_config_with_override(config_override)
    mode = str(cfg.get("mode", "codex") or "").strip().lower()
    ping_prompt = "reply ok"
    timeout = 12

    if mode == "gemini":
        access_mode = _get_engine_runtime_access(cfg, "gemini")
        if access_mode == "api":
            ok, _, err = _call_gemini_official_api(ping_prompt, cfg=cfg)
            if ok:
                return {"ok": True, "engine_mode": mode, "model": cfg.get("gemini_model", ""), "message": "连接检测通过"}
            return {"ok": False, "engine_mode": mode, "model": cfg.get("gemini_model", ""), "message": err or "Gemini API 调用失败"}
        path = _resolve_gemini_cmd()
        if not path:
            _runtime_mark_error("gemini", cfg.get("gemini_model", ""), "missing executable")
            return {"ok": False, "engine_mode": mode, "message": "未检测到 gemini 可执行文件"}
        ok, detail = _probe_cli_with_timeout_fallback("gemini", path, ["-help"], cfg)
        if ok:
            _runtime_mark_success("gemini", cfg.get("gemini_model", ""), failover=False)
            return {"ok": True, "engine_mode": mode, "model": cfg.get("gemini_model", ""), "message": "连接检测通过"}
        _runtime_mark_error("gemini", cfg.get("gemini_model", ""), detail or "cli probe failed")
        return {"ok": False, "engine_mode": mode, "model": cfg.get("gemini_model", ""), "message": detail or "Gemini CLI 调用失败"}

    if mode == "claude":
        access_mode = _get_engine_runtime_access(cfg, "claude")
        if access_mode == "api":
            ok, _, err = _call_claude_official_api(ping_prompt, cfg=cfg)
            if ok:
                return {"ok": True, "engine_mode": mode, "model": cfg.get("claude_model", ""), "message": "连接检测通过"}
            return {"ok": False, "engine_mode": mode, "model": cfg.get("claude_model", ""), "message": err or "Claude API 调用失败"}
        path = _resolve_claude_cmd()
        if not path:
            _runtime_mark_error("claude", cfg.get("claude_model", ""), "missing executable")
            return {"ok": False, "engine_mode": mode, "message": "未检测到 claude 可执行文件"}
        ok, detail = _probe_cli_with_timeout_fallback("claude", path, ["--help"], cfg)
        if ok:
            _runtime_mark_success("claude", cfg.get("claude_model", ""), failover=False)
            return {"ok": True, "engine_mode": mode, "model": cfg.get("claude_model", ""), "message": "连接检测通过"}
        _runtime_mark_error("claude", cfg.get("claude_model", ""), detail or "cli probe failed")
        return {"ok": False, "engine_mode": mode, "model": cfg.get("claude_model", ""), "message": detail or "Claude CLI 调用失败"}

    if mode == "codex":
        access_mode = _get_engine_runtime_access(cfg, "codex")
        if access_mode == "api":
            ok, _, err = _call_codex_official_api(ping_prompt, cfg=cfg)
            if ok:
                return {"ok": True, "engine_mode": mode, "model": cfg.get("codex_model", ""), "message": "连接检测通过"}
            return {"ok": False, "engine_mode": mode, "model": cfg.get("codex_model", ""), "message": err or "ChatGPT API 调用失败"}
        path = _resolve_codex_cmd()
        if not path:
            _runtime_mark_error("codex", cfg.get("codex_model", ""), "missing executable")
            return {"ok": False, "engine_mode": mode, "message": "未检测到 codex 可执行文件"}
        ok, detail = _probe_cli_with_timeout_fallback("codex", path, ["--help"], cfg)
        if ok:
            _runtime_mark_success("codex", cfg.get("codex_model", ""), failover=False)
            return {"ok": True, "engine_mode": mode, "model": cfg.get("codex_model", ""), "message": "连接检测通过"}
        _runtime_mark_error("codex", cfg.get("codex_model", ""), detail or "cli probe failed")
        return {"ok": False, "engine_mode": mode, "model": cfg.get("codex_model", ""), "message": detail or "ChatGPT CLI 调用失败"}

    if mode == "api":
        resolved = _resolve_api_runtime_config(cfg)
        base_url = resolved.get("base_url", "")
        api_key = resolved.get("api_key", "")
        api_model = resolved.get("model", "")
        wire_api = resolved.get("wire_api", "auto")
        if not base_url or not api_key or not api_model:
            return {"ok": False, "engine_mode": mode, "message": "api 模式需要 base url、api key 和模型"}

        chat_url = _normalize_api_url(base_url)
        responses_url = _normalize_api_responses_url(base_url)
        attempts = []
        if wire_api == "responses":
            attempts = [("responses", responses_url), ("chat", chat_url)]
        elif wire_api == "chat":
            attempts = [("chat", chat_url), ("responses", responses_url)]
        else:
            attempts = [("chat", chat_url), ("responses", responses_url)]

        last_err = "连接检测失败"
        for idx, (kind, url) in enumerate(attempts):
            _runtime_mark_attempt("api", api_model)
            payload = {"model": api_model}
            if kind == "chat":
                payload["messages"] = [{"role": "user", "content": ping_prompt}]
            else:
                payload["input"] = ping_prompt
            try:
                raw = _http_post_json(url, payload, api_key, timeout_seconds=timeout, retries=1)
                data = json.loads(raw)
                content = _extract_chat_content(data) or _extract_responses_content(data)
                if content:
                    _runtime_mark_success("api", api_model, failover=idx > 0)
                    return {"ok": True, "engine_mode": mode, "model": api_model, "message": "连接检测通过"}
                last_err = f"api {kind} 返回为空"
                _runtime_mark_error("api", api_model, last_err)
            except Exception as e:
                last_err = f"api {kind} 失败: {e}"
                _runtime_mark_error("api", api_model, str(e))
        return {"ok": False, "engine_mode": mode, "model": api_model, "message": last_err}

    if mode == "personal":
        resolved = _resolve_personal_runtime_config(cfg)
        chat_url = resolved.get("chat_url", "")
        api_key = resolved.get("api_key", "")
        models = _rank_models_for_failover("personal", resolved.get("models", []))
        if not chat_url or not api_key:
            return {"ok": False, "engine_mode": mode, "message": "个人配置需要 base url 和 api key"}
        last_err = "连接检测失败"
        for idx, model in enumerate(models):
            _runtime_mark_attempt("personal", model)
            payload = {"model": model, "messages": [{"role": "user", "content": ping_prompt}]}
            try:
                raw = _http_post_json(chat_url, payload, api_key, timeout_seconds=timeout, retries=1, disable_proxy=True)
                data = json.loads(raw)
                content = _extract_chat_content(data) or _extract_responses_content(data)
                if content:
                    _runtime_mark_success("personal", model, failover=idx > 0)
                    return {"ok": True, "engine_mode": mode, "model": model, "message": "连接检测通过"}
                last_err = f"personal 返回为空（model={model}）"
                _runtime_mark_error("personal", model, "empty content")
            except Exception as e:
                last_err = f"personal 失败（model={model}）: {e}"
                _runtime_mark_error("personal", model, str(e))
        return {"ok": False, "engine_mode": mode, "message": last_err}

    if mode == "doubao":
        configured_models = _parse_doubao_models(
            cfg.get("doubao_models", ""),
            cfg.get("doubao_model", "") or _DOUBAO_DEFAULT_MODEL,
        )
        model = configured_models[0] if configured_models else _DOUBAO_DEFAULT_MODEL
        api_key = _resolve_doubao_api_key(cfg)
        if not api_key:
            return {"ok": False, "engine_mode": mode, "message": "豆包模式需要 DOUBAO_API_KEY 或 ARK_API_KEY"}
        _runtime_mark_success("doubao", model, failover=False)
        return {"ok": True, "engine_mode": mode, "model": model, "message": "已检测到豆包 API Key（未发起联网验活）"}

    return {"ok": False, "engine_mode": mode, "message": f"不支持的引擎模式：{mode}"}


def _probe_local_tcp(port, timeout=0.25):
    try:
        p = int(port)
    except (TypeError, ValueError):
        return False
    if p <= 0 or p > 65535:
        return False
    try:
        with socket.create_connection(("127.0.0.1", p), timeout=timeout):
            return True
    except Exception:
        return False


def _probe_cli_command_ready(command, timeout=1.2):
    cmd = str(command or "").strip()
    if not cmd:
        return False, ""

    variants = (
        ["--help"],
    )
    last_error = ""
    for args in variants:
        invoke = [cmd] + list(args)
        if os.name == "nt" and cmd.lower().endswith((".cmd", ".bat")):
            invoke = ["cmd", "/c", cmd] + list(args)
        try:
            proc = subprocess.run(
                invoke,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
            merged = f"{proc.stdout or ''}\n{proc.stderr or ''}".strip()
            if proc.returncode == 0 or bool(merged):
                return True, cmd
            last_error = f"rc={proc.returncode}"
        except subprocess.TimeoutExpired:
            return False, f"{cmd}（命令响应超时）"
        except Exception as e:
            last_error = str(e)
    detail = f"{cmd}（--help 检测失败：{last_error}）" if last_error else cmd
    return False, detail


def _probe_cli_command_with_args(command, args, timeout=8.0, env=None):
    cmd = str(command or "").strip()
    if not cmd:
        return False, ""
    argv = [str(x) for x in (args or []) if str(x or "").strip()]
    if not argv:
        argv = ["--help"]
    invoke = [cmd] + argv
    if os.name == "nt":
        lower = cmd.lower()
        if lower.endswith((".cmd", ".bat")):
            invoke = ["cmd", "/c", cmd] + argv
        elif lower.endswith(".ps1"):
            invoke = [
                _resolve_powershell_cmd(),
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                cmd,
            ] + argv
    try:
        proc = subprocess.run(
            invoke,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
        merged = f"{proc.stdout or ''}\n{proc.stderr or ''}".strip()
        if proc.returncode == 0 or bool(merged):
            return True, cmd
        return False, f"{cmd}（{' '.join(argv)} 返回码 {proc.returncode}）"
    except subprocess.TimeoutExpired:
        return False, f"{cmd}（命令响应超时）"
    except Exception as e:
        return False, f"{cmd}（{e}）"


def _probe_cli_with_timeout_fallback(engine, command, args, cfg, timeout=8.0):
    env = _build_engine_env({**(cfg or {}), "mode": str(engine or "").strip().lower()})
    ok, detail = _probe_cli_command_with_args(command, args, timeout=timeout, env=env)
    if ok:
        return True, detail

    detail_text = str(detail or "")
    config_path = _cli_config_path(engine)
    if "命令响应超时" in detail_text and config_path:
        return True, f"{detail_text}；已检测到配置：{config_path}"
    return False, detail


def get_startup_self_check():
    cfg = _get_engine_config()
    proxy_port = _normalize_proxy_port(cfg.get("proxy_port", _DEFAULT_PROXY_PORT))
    checks = []
    codex_access_mode = _get_engine_runtime_access(cfg, "codex")
    gemini_access_mode = _get_engine_runtime_access(cfg, "gemini")
    claude_access_mode = _get_engine_runtime_access(cfg, "claude")

    any_cli_mode = False

    if codex_access_mode == "api":
        codex_api_key = _resolve_codex_api_key(cfg)
        checks.append(
            {
                "id": "key_codex_api",
                "name": "ChatGPT API Key",
                "ok": bool(codex_api_key),
                "detail": "已配置" if codex_api_key else "未配置 OPENAI_API_KEY",
            }
        )
    else:
        any_cli_mode = True
        codex_cmd = _resolve_codex_cmd()
        codex_ok, codex_detail = _probe_cli_with_timeout_fallback("codex", codex_cmd, ["--help"], cfg)
        checks.append(
            {
                "id": "cli_codex",
                "name": "ChatGPT CLI",
                "ok": bool(codex_ok),
                "detail": codex_detail or "未检测到 codex 可执行文件",
            }
        )

    if gemini_access_mode == "api":
        gemini_api_key = _resolve_gemini_api_key(cfg)
        checks.append(
            {
                "id": "key_gemini_api",
                "name": "Gemini API Key",
                "ok": bool(gemini_api_key),
                "detail": "已配置" if gemini_api_key else "未配置 GEMINI_API_KEY/GOOGLE_API_KEY",
            }
        )
    else:
        any_cli_mode = True
        gemini_cmd = _resolve_gemini_cmd()
        gemini_ok, gemini_detail = _probe_cli_with_timeout_fallback("gemini", gemini_cmd, ["-help"], cfg)
        checks.append(
            {
                "id": "cli_gemini",
                "name": "Gemini CLI",
                "ok": bool(gemini_ok),
                "detail": gemini_detail or "未检测到 gemini 可执行文件",
            }
        )

    if claude_access_mode == "api":
        claude_api_key = _resolve_claude_api_key(cfg)
        checks.append(
            {
                "id": "key_claude_api",
                "name": "Claude API Key",
                "ok": bool(claude_api_key),
                "detail": "已配置" if claude_api_key else "未配置 ANTHROPIC_API_KEY",
            }
        )
    else:
        any_cli_mode = True
        claude_cmd = _resolve_claude_cmd()
        claude_ok, claude_detail = _probe_cli_with_timeout_fallback("claude", claude_cmd, ["--help"], cfg)
        checks.append(
            {
                "id": "cli_claude",
                "name": "Claude CLI",
                "ok": bool(claude_ok),
                "detail": claude_detail or "未检测到 claude 可执行文件",
            }
        )

    if any_cli_mode:
        proxy_ok = _probe_local_tcp(proxy_port, timeout=0.2)
        checks.append(
            {
                "id": "proxy_port",
                "name": f"代理端口 {proxy_port}",
                "ok": bool(proxy_ok),
                "detail": "已监听" if proxy_ok else "未监听（仅影响 CLI 模式）",
            }
        )

    doubao_key = _resolve_doubao_api_key(cfg)
    checks.append(
        {
            "id": "key_doubao",
            "name": "豆包 API Key",
            "ok": bool(doubao_key),
            "detail": "已配置" if doubao_key else "未配置 DOUBAO_API_KEY/ARK_API_KEY",
        }
    )

    personal_cfg = _resolve_personal_runtime_config(cfg)
    checks.append(
        {
            "id": "key_personal",
            "name": "个人配置 API Key",
            "ok": bool(personal_cfg.get("api_key")),
            "detail": "已配置" if personal_cfg.get("api_key") else "未配置",
        }
    )
    checks.append(
        {
            "id": "url_personal",
            "name": "个人配置 Base URL",
            "ok": bool(personal_cfg.get("chat_url")),
            "detail": personal_cfg.get("chat_url") or "未配置",
        }
    )

    required_for_current = []
    mode = str(cfg.get("mode", "codex") or "").strip().lower()
    if mode == "codex":
        if codex_access_mode == "api":
            required_for_current.append("key_codex_api")
        else:
            required_for_current.append("proxy_port")
            required_for_current.append("cli_codex")
    elif mode in {"gemini", "claude"}:
        access_mode = _get_engine_runtime_access(cfg, mode)
        if access_mode == "api":
            required_for_current.append(f"key_{mode}_api")
        else:
            required_for_current.append("proxy_port")
            required_for_current.append(f"cli_{mode}")
    elif mode == "doubao":
        required_for_current.append("key_doubao")
    elif mode == "personal":
        required_for_current.extend(["key_personal", "url_personal"])

    required_set = set(required_for_current)
    all_ok = all(item["ok"] for item in checks if item["id"] in required_set) if required_set else True
    return {
        "engine_mode": mode,
        "all_ok": bool(all_ok),
        "checks": checks,
        "required_ids": sorted(required_set),
    }


def _engine_error_prefix(mode):
    if mode == "gemini":
        return "gemini"
    if mode == "claude":
        return "claude exec"
    return "codex exec"


def _build_cli_command_variants(cfg):
    mode = str(cfg.get("mode", "") or "").strip().lower()
    if mode in {"codex", "gemini", "claude"} and _get_engine_runtime_access(cfg, mode) == "api":
        return []
    variants = []
    if mode == "gemini":
        gemini_cmd = _resolve_gemini_cmd() or "gemini"
        base_cmd = [gemini_cmd, "-p", ""]
        if cfg["gemini_model"]:
            base_cmd.extend(["-m", cfg["gemini_model"]])
        variants.append(
            {
                "label": "gemini stream-json",
                "cmd": base_cmd + ["-o", "stream-json"],
                "parse_stream_json": True,
            }
        )
        variants.append(
            {
                "label": "gemini text",
                "cmd": base_cmd,
                "parse_stream_json": False,
            }
        )
        return variants

    if mode == "claude":
        claude_cmd = _resolve_claude_cmd()
        if not claude_cmd:
            return []
        base_cmd = [claude_cmd, "-p"]
        if cfg["claude_model"]:
            base_cmd.extend(["--model", cfg["claude_model"]])
        variants.append(
            {
                "label": "claude stream-json",
                "cmd": base_cmd + ["--output-format", "stream-json", "--include-partial-messages"],
                "parse_stream_json": True,
            }
        )
        variants.append(
            {
                "label": "claude text",
                "cmd": base_cmd,
                "parse_stream_json": False,
            }
        )
        return variants

    codex_cmd = _resolve_codex_cmd()
    if not codex_cmd:
        return []
    codex_args = "exec --full-auto --skip-git-repo-check"
    if cfg["codex_model"]:
        codex_args += f" --model {_quote_ps_arg(cfg['codex_model'])}"
    effort = _normalize_reasoning_effort(cfg.get("codex_reasoning_effort", "medium"))
    codex_args += f" -c {_quote_ps_arg(f'model_reasoning_effort=\"{effort}\"')}"
    variants.append(
        {
            "label": "codex jsonl",
            "cmd": _build_powershell_cmd(codex_cmd, f"{codex_args} --json -"),
            "parse_stream_json": True,
        }
    )
    variants.append(
        {
            "label": "codex text",
            "cmd": _build_powershell_cmd(codex_cmd, f"{codex_args} -"),
            "parse_stream_json": False,
        }
    )
    return variants


def _run_prompt(prompt, reasoning_effort_override=None):
    ok, out, err = _run_prompt_with_progress(
        prompt,
        on_progress=None,
        reasoning_effort_override=reasoning_effort_override,
    )
    return ok, out, err


def _is_preface_line(line):
    if not line:
        return False
    text = line.strip()
    starters = (
        "好的",
        "当然",
        "以下是",
        "下面是",
        "这是",
        "我将",
        "我会",
        "根据你",
        "根据设定",
    )
    if text.startswith(starters) and len(text) <= 80:
        return True
    if re.match(r"^(好的|当然|以下是|下面是).*[：:。]?$", text):
        return True
    return False


def _clean_generated_text(text):
    if not text:
        return ""
    s = text.replace("\r\n", "\n").strip()
    s = re.sub(
        r"\n*(?:---\s*\n)?SESSION_ID:\s*[0-9a-fA-F-]+\s*$",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"^```[^\n]*\n?", "", s)
    s = re.sub(r"\n?```$", "", s)
    s = s.replace("```", "").strip()

    lines = [x.strip() for x in s.split("\n")]
    while lines and _is_preface_line(lines[0]):
        lines.pop(0)

    s = "\n".join(lines).strip()
    s = re.sub(r"^(正文|小说正文|内容)[：:]\s*", "", s)
    s = _strip_trailing_meta_notes(s)
    return s.strip()


def _strip_trailing_meta_notes(text):
    s = str(text or "").strip()
    if not s:
        return ""

    note_line_re = re.compile(r"^\s*(?:[（(]\s*)?(?:注|备注|说明)[:：].*$", re.IGNORECASE)
    note_keywords = (
        "用户要求",
        "符合要求",
        "故事有完整",
        "情绪起伏",
        "人物行为一致",
        "叙事推进",
        "约2000字",
        "约为",
        "字数",
    )

    def _is_meta_tail(line):
        x = str(line or "").strip()
        if not x:
            return False
        if note_line_re.match(x):
            return True
        hit_count = sum(1 for k in note_keywords if k in x)
        return hit_count >= 2

    changed = True
    while changed and s:
        changed = False

        lines = s.split("\n")
        while lines and not lines[-1].strip():
            lines.pop()
            changed = True
        if lines and _is_meta_tail(lines[-1]):
            lines.pop()
            while lines and not lines[-1].strip():
                lines.pop()
            s = "\n".join(lines).strip()
            changed = True
            continue

        # Remove a trailing parenthesized note block, e.g. "（注：...）"
        m = re.search(r"([（(]\s*(?:注|备注|说明)[:：][\s\S]*?[）)])\s*$", s, re.IGNORECASE)
        if m:
            s = s[: m.start()].rstrip()
            changed = True

    return s


def _clean_title(text):
    if not text:
        return ""
    s = text.replace("\r\n", "\n").strip()
    s = re.sub(r"^```[^\n]*\n?", "", s)
    s = re.sub(r"\n?```$", "", s)
    s = s.replace("`", "").strip()

    for line in s.split("\n"):
        line = line.strip()
        if line:
            s = line
            break

    s = re.sub(r"^(标题|建议标题|章名|题目)[：:\s]+", "", s)
    s = re.sub(r"^第[0-9一二三四五六七八九十百千]+[章节回卷部集篇]\s*", "", s)
    s = s.strip("《》\u201c\u201d\"'''[]\u3010\u3011()\uff08\uff09")
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", s)

    if len(s) > 10:
        s = s[:10]
    if len(s) < 4:
        s = "未名之章"
    return s


def _clean_outline_text(text):
    if not text:
        return ""
    s = str(text or "").replace("\r\n", "\n").strip()
    s = re.sub(r"^```[^\n]*\n?", "", s)
    s = re.sub(r"\n?```$", "", s)
    s = s.replace("```", "").strip()

    lines = [line.rstrip() for line in s.split("\n")]
    while lines and _is_preface_line(lines[0].strip()):
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines).strip()


def _load_cache_summary():
    try:
        project = load_project()
    except Exception:
        return "（暂无缓存内容）"

    cache = project.get("cache", "")
    if isinstance(cache, dict):
        cache = cache.get("summary", "")
    if cache is None:
        cache = ""

    cache = str(cache).strip()
    if not cache:
        return "（暂无缓存内容）"
    return cache


def generate_novel_batch(
    outline,
    reference,
    requirements,
    *args,
    word_target=None,
    extra_settings=None,
    global_memory=None,
    draft_so_far=None,
    reasoning_effort=None,
):
    # Backward-compatible positional parsing:
    # old: (extra_settings, global_memory, draft_so_far)
    # new: (word_target, extra_settings, global_memory, draft_so_far)
    resolved_word_target = "" if word_target is None else word_target
    resolved_extra_settings = "" if extra_settings is None else extra_settings
    resolved_global_memory = "" if global_memory is None else global_memory
    resolved_draft_so_far = "" if draft_so_far is None else draft_so_far
    if args:
        if len(args) == 3:
            resolved_extra_settings, resolved_global_memory, resolved_draft_so_far = args[:3]
        elif len(args) >= 4:
            resolved_word_target, resolved_extra_settings, resolved_global_memory, resolved_draft_so_far = args[:4]

    cache_summary = _load_cache_summary()
    prompt = f"""你是一位中文长篇小说作者，请基于以下信息继续写作。

【故事大纲】
{outline or "无"}

【参考设定/文风参考】
{reference or "无"}

【写作要求】
{requirements or "无"}

【字数设定】
{resolved_word_target or "无"}

【补充设定】
{resolved_extra_settings or "无"}

【全局记忆】
{resolved_global_memory or "无"}

【已完成章节摘要】
{cache_summary}

【当前已写草稿】
{resolved_draft_so_far or "（暂无）"}

请严格输出约{CHARS_PER_BATCH}字中文小说正文，要求：
1. 只输出正文内容，不要标题、编号、解释、注释、前言、后记。
2. 保持情节连贯、人物行为一致、语言自然。
3. 尽量形成完整的叙事推进与情绪起伏。
4. 不要使用Markdown格式，不要代码块，不要多余说明。
5. 注意根据语义和段意合理分段，每段200-400字为宜，段落之间用空行分隔。
"""

    ok, raw, err = _run_prompt(prompt, reasoning_effort_override=reasoning_effort)
    if not ok:
        return {"success": False, "content": "", "error": err}

    content = _clean_generated_text(raw)
    if not content:
        return {"success": False, "content": "", "error": "生成结果为空"}
    return {"success": True, "content": content, "error": None}


def generate_outline(
    outline_seed,
    reference,
    requirements,
    *args,
    word_target=None,
    extra_settings=None,
    global_memory=None,
    reasoning_effort=None,
):
    # Backward-compatible positional parsing:
    # old: (extra_settings, global_memory)
    # new: (word_target, extra_settings, global_memory)
    resolved_word_target = "" if word_target is None else word_target
    resolved_extra_settings = "" if extra_settings is None else extra_settings
    resolved_global_memory = "" if global_memory is None else global_memory
    if args:
        if len(args) == 2:
            resolved_extra_settings, resolved_global_memory = args[:2]
        elif len(args) >= 3:
            resolved_word_target, resolved_extra_settings, resolved_global_memory = args[:3]

    prompt = f"""你是中文长篇小说策划编辑，请输出一份可直接用于写作的大纲。

【已有大纲（可为空）】
{outline_seed or "无"}

【参考设定/文风参考】
{reference or "无"}

【写作要求】
{requirements or "无"}

【字数设定】
{resolved_word_target or "无"}

【补充设定】
{resolved_extra_settings or "无"}

【全局记忆】
{resolved_global_memory or "无"}

输出要求：
1. 直接输出大纲正文，不要任何前言、解释、注释。
2. 结构至少包含：主题、世界观、主线、主要角色、阶段剧情（开端/发展/高潮/结局）、伏笔与回收点。
3. 大纲要具备可执行性，分层清楚，便于后续逐章创作。
4. 不要输出 Markdown 代码块。
"""

    ok, raw, err = _run_prompt(prompt, reasoning_effort_override=reasoning_effort)
    if not ok:
        return {"success": False, "outline": "", "error": err}

    outline = _clean_outline_text(raw)
    if not outline:
        return {"success": False, "outline": "", "error": "生成结果为空"}
    return {"success": True, "outline": outline, "error": None}


def polish_draft(
    draft_content,
    polish_requirements,
    reference,
    requirements,
    *args,
    word_target=None,
    extra_settings=None,
    global_memory=None,
    reasoning_effort=None,
):
    # Backward-compatible positional parsing:
    # old: (extra_settings, global_memory)
    # new: (word_target, extra_settings, global_memory)
    resolved_word_target = "" if word_target is None else word_target
    resolved_extra_settings = "" if extra_settings is None else extra_settings
    resolved_global_memory = "" if global_memory is None else global_memory
    if args:
        if len(args) == 2:
            resolved_extra_settings, resolved_global_memory = args[:2]
        elif len(args) >= 3:
            resolved_word_target, resolved_extra_settings, resolved_global_memory = args[:3]

    prompt = f"""你是中文小说润色编辑。请在不改变核心剧情事实与人物关系的前提下，润色下列正文。

【待润色正文】
{draft_content or "无"}

【润色要求】
{polish_requirements or "提升表达质量与可读性，优化节奏和段落层次。"}

【参考设定/文风参考】
{reference or "无"}

【写作要求】
{requirements or "无"}

【字数设定】
{resolved_word_target or "无"}

【补充设定】
{resolved_extra_settings or "无"}

【全局记忆】
{resolved_global_memory or "无"}

输出要求：
1. 仅输出润色后的正文，不要解释、注释、前言、后记。
2. 保持叙事视角一致、人设与世界观一致。
3. 不新增与原文冲突的剧情事实，不遗漏关键信息。
4. 不输出 Markdown 代码块。
"""

    ok, raw, err = _run_prompt(prompt, reasoning_effort_override=reasoning_effort)
    if not ok:
        return {"success": False, "content": "", "error": err}

    content = _clean_generated_text(raw)
    if not content:
        return {"success": False, "content": "", "error": "润色结果为空"}
    return {"success": True, "content": content, "error": None}


def optimize_reference_prompt(reference, reasoning_effort=None):
    prompt = f"""你是中文长篇小说提示词工程师。请把“原始参考文本”优化为高信息密度、低冗余、可直接用于模型写作的提示词。

【原始参考文本】
{reference or "无"}

输出规则（必须遵守）：
1. 只输出“优化后的参考文本”，不要任何解释、前言、后记、注释。
2. 必须按以下顺序输出 8 个小节：
   类型定位
   结构逻辑
   人物系统
   设定规则
   语言风格
   情绪曲线
   爽点机制
   主题价值观与可量化参数
3. 每个小节只保留可执行信息：关键约束、关键角色、规则边界、冲突推进、节奏节点、明确指标。
4. 删除重复与空泛措辞，避免形容词堆叠；保留可落地的创作指令。
5. 字数控制在原文本的 30%-60%，但不少于 220 字。
6. 不要输出 Markdown 代码块。
"""

    ok, raw, err = _run_prompt(prompt, reasoning_effort_override=reasoning_effort)
    if not ok:
        return {"success": False, "reference": "", "error": err}

    optimized = _clean_outline_text(raw)
    if not optimized:
        return {"success": False, "reference": "", "error": "总结结果为空"}
    return {"success": True, "reference": optimized, "error": None}

def _select_thinking_text(elapsed_seconds, clean_text_length):
    time_progress = min(int(elapsed_seconds * 100 / _ESTIMATED_SECONDS), 100)
    content_progress = min(
        int(clean_text_length * 100 / max(CHARS_PER_BATCH, 1)),
        100,
    )
    progress = max(time_progress, content_progress)

    thinking = THINKING_PHASES[0][1]
    for threshold, text in THINKING_PHASES:
        if progress >= threshold:
            thinking = text
    return thinking


def _run_blocking_with_simulated_progress(
    func,
    prompt,
    on_progress=None,
    should_stop=None,
):
    result_holder = {"ok": False, "out": "", "err": "interrupted", "finished": False}

    def _target():
        try:
            ok, out, err = func(prompt)
            result_holder["ok"] = ok
            result_holder["out"] = out
            result_holder["err"] = err
        except Exception as e:
            result_holder["err"] = str(e)
        finally:
            result_holder["finished"] = True

    t = threading.Thread(target=_target, daemon=True)
    t.start()

    start_time = time.monotonic()
    last_thinking = None

    while not result_holder["finished"]:
        if should_stop and should_stop():
            return False, "", "stopped by user"

        elapsed = time.monotonic() - start_time
        thinking = _select_thinking_text(elapsed, 0)

        if on_progress and thinking != last_thinking:
            last_thinking = thinking
            on_progress("", thinking)

        time.sleep(0.5)

    t.join(timeout=0.1)
    return result_holder["ok"], result_holder["out"], result_holder["err"]


def _run_prompt_with_progress(
    prompt,
    on_progress,
    should_stop=None,
    on_process_start=None,
    on_process_end=None,
    reasoning_effort_override=None,
):
    def _run_single_engine(
        cmd,
        prompt_text=None,
        input_encoding=None,
        env=None,
        parse_stream_json=False,
        timeout_seconds=CODEX_TIMEOUT,
        should_stop=None,
        on_process_start=None,
        on_process_end=None,
    ):
        errors = []
        output_file = None
        output_path = None
        proc = None
        stop_event = threading.Event()
        start_time = time.monotonic()
        first_token_ms = None
        last_payload = {"content": None, "thinking": None}

        def _read_output():
            if not output_path:
                return ""
            try:
                with open(output_path, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except Exception:
                return ""

        def _emit_progress(force=False):
            nonlocal first_token_ms
            if not on_progress:
                return
            raw_text = _read_output()
            cleaned = _normalize_command_output(raw_text, parse_stream_json=parse_stream_json)
            if cleaned and first_token_ms is None:
                first_token_ms = (time.monotonic() - start_time) * 1000.0
            thinking = _select_thinking_text(time.monotonic() - start_time, len(cleaned))
            if (
                force
                or cleaned != last_payload["content"]
                or thinking != last_payload["thinking"]
            ):
                last_payload["content"] = cleaned
                last_payload["thinking"] = thinking
                on_progress(cleaned, thinking)

        def _progress_worker():
            while not stop_event.wait(_PROGRESS_POLL_INTERVAL):
                _emit_progress()
            _emit_progress(force=True)

        progress_thread = None
        stderr_text = ""
        timed_out = False
        stopped_by_user = False

        try:
            if should_stop and should_stop():
                total_ms = (time.monotonic() - start_time) * 1000.0
                return False, "", "stopped by user", {"total_ms": total_ms, "first_token_ms": first_token_ms}
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix=".txt",
                delete=False,
            ) as tmp:
                output_path = tmp.name

            output_file = open(output_path, "w", encoding="utf-8", errors="replace")

            popen_kwargs = {
                "stdout": output_file,
                "stderr": subprocess.PIPE,
                "text": True,
                "encoding": input_encoding,
                "errors": "replace",
                "env": env,
            }
            if prompt_text is not None:
                popen_kwargs["stdin"] = subprocess.PIPE

            progress_thread = threading.Thread(target=_progress_worker, daemon=True)
            progress_thread.start()

            proc = subprocess.Popen(cmd, **popen_kwargs)
            if on_process_start:
                try:
                    on_process_start(proc)
                except Exception:
                    pass
            try:
                communicate_input = prompt_text if prompt_text is not None else None
                deadline = time.monotonic() + max(float(timeout_seconds or 0), 1.0)

                while True:
                    now = time.monotonic()
                    if now >= deadline:
                        timed_out = True
                        proc.kill()
                        _, stderr_text = proc.communicate()
                        break

                    if should_stop and should_stop():
                        stopped_by_user = True
                        proc.kill()
                        _, stderr_text = proc.communicate()
                        break

                    try:
                        _, stderr_text = proc.communicate(
                            communicate_input,
                            timeout=min(0.5, max(0.1, deadline - now)),
                        )
                        break
                    except subprocess.TimeoutExpired:
                        communicate_input = None
                        continue
            finally:
                output_file.flush()

            stop_event.set()
            if progress_thread:
                progress_thread.join(timeout=2)

            stdout_raw = _read_output().strip()
            stdout_text = _normalize_command_output(stdout_raw, parse_stream_json=parse_stream_json)
            stderr_text = (stderr_text or "").strip()
            if stopped_by_user:
                total_ms = (time.monotonic() - start_time) * 1000.0
                return False, stdout_text, "stopped by user", {"total_ms": total_ms, "first_token_ms": first_token_ms}
            if timed_out:
                total_ms = (time.monotonic() - start_time) * 1000.0
                return False, stdout_text, f"timeout after {timeout_seconds}s", {"total_ms": total_ms, "first_token_ms": first_token_ms}
            if proc.returncode == 0 and stdout_text:
                total_ms = (time.monotonic() - start_time) * 1000.0
                return True, stdout_text, None, {"total_ms": total_ms, "first_token_ms": first_token_ms or total_ms}
            if stderr_text:
                total_ms = (time.monotonic() - start_time) * 1000.0
                return False, stdout_text, stderr_text, {"total_ms": total_ms, "first_token_ms": first_token_ms}
            total_ms = (time.monotonic() - start_time) * 1000.0
            return False, stdout_text, f"returncode={proc.returncode}", {"total_ms": total_ms, "first_token_ms": first_token_ms}
        except Exception as e:
            errors.append(str(e))
            raw_text = _read_output().strip()
            stdout_text = _normalize_command_output(raw_text, parse_stream_json=parse_stream_json)
            total_ms = (time.monotonic() - start_time) * 1000.0
            return False, stdout_text, "; ".join(errors), {"total_ms": total_ms, "first_token_ms": first_token_ms}
        finally:
            stop_event.set()
            if progress_thread and progress_thread.is_alive():
                progress_thread.join(timeout=1)
            if on_process_end:
                try:
                    on_process_end(proc)
                except Exception:
                    pass
            if output_file and not output_file.closed:
                output_file.close()
            if output_path:
                try:
                    os.remove(output_path)
                except OSError:
                    pass

    cfg = _get_engine_config()
    cfg = _apply_reasoning_override(cfg, reasoning_effort_override)
    prompt = _with_reasoning_instruction(prompt, cfg)
    timeout_seconds = _get_engine_timeout(cfg["mode"])
    access_mode = _get_engine_runtime_access(cfg, cfg.get("mode", ""))
    if cfg["mode"] in {"codex", "gemini", "claude"} and access_mode == "api":
        return _run_blocking_with_simulated_progress(
            lambda text: _call_selected_engine_api(text, cfg=cfg),
            prompt,
            on_progress,
            should_stop,
        )
    if cfg["mode"] == "api":
        return _run_blocking_with_simulated_progress(
            _call_api, prompt, on_progress, should_stop
        )
    if cfg["mode"] == "doubao":
        return _call_doubao_with_progress(
            prompt,
            on_progress=on_progress,
            should_stop=should_stop,
        )
    if cfg["mode"] == "personal":
        return _call_personal_with_progress(
            prompt,
            on_progress=on_progress,
            should_stop=should_stop,
        )

    variants = _build_cli_command_variants(cfg)
    if not variants:
        prefix = _engine_error_prefix(cfg["mode"])
        if cfg["mode"] == "claude":
            return False, "", f"{prefix}: 未找到 claude 可执行文件（请检查 PATH）"
        return False, "", f"{prefix}: 未找到 codex 可执行文件（请检查 CODEX_CMD 或 PATH）"

    errors = []
    runtime_model = ""
    if cfg["mode"] == "gemini":
        runtime_model = cfg.get("gemini_model", "")
    elif cfg["mode"] == "claude":
        runtime_model = cfg.get("claude_model", "")
    else:
        runtime_model = cfg.get("codex_model", "")
    for variant in variants:
        _runtime_mark_attempt(cfg["mode"], runtime_model)
        ok, out, err, metrics = _run_single_engine(
            variant["cmd"],
            prompt_text=prompt,
            input_encoding="utf-8",
            env=_build_engine_env(cfg),
            parse_stream_json=bool(variant.get("parse_stream_json")),
            timeout_seconds=timeout_seconds,
            should_stop=should_stop,
            on_process_start=on_process_start,
            on_process_end=on_process_end,
        )
        if ok:
            _runtime_mark_success(
                cfg["mode"],
                runtime_model,
                failover=bool(errors),
                total_ms=(metrics or {}).get("total_ms"),
                first_token_ms=(metrics or {}).get("first_token_ms"),
            )
            return True, out, None
        _runtime_mark_error(
            cfg["mode"],
            runtime_model,
            err or "variant failed",
            total_ms=(metrics or {}).get("total_ms"),
            first_token_ms=(metrics or {}).get("first_token_ms"),
        )
        prefix = _engine_error_prefix(cfg["mode"])
        label = variant.get("label", "")
        if label:
            errors.append(f"{prefix} [{label}]: {err}")
        else:
            errors.append(f"{prefix}: {err}")

    return False, "", " | ".join([e for e in errors if e]) or "未知错误"


def generate_novel_with_progress(
    outline,
    reference,
    requirements,
    *args,
    word_target=None,
    extra_settings=None,
    global_memory=None,
    draft_so_far=None,
    reasoning_effort=None,
    on_progress=None,
    should_stop=None,
    on_process_start=None,
    on_process_end=None,
    request_id="",
):
    # Backward-compatible positional parsing:
    # old: (extra_settings, global_memory, draft_so_far)
    # new: (word_target, extra_settings, global_memory, draft_so_far)
    resolved_word_target = "" if word_target is None else word_target
    resolved_extra_settings = "" if extra_settings is None else extra_settings
    resolved_global_memory = "" if global_memory is None else global_memory
    resolved_draft_so_far = "" if draft_so_far is None else draft_so_far
    if args:
        if len(args) == 3:
            resolved_extra_settings, resolved_global_memory, resolved_draft_so_far = args[:3]
        elif len(args) >= 4:
            resolved_word_target, resolved_extra_settings, resolved_global_memory, resolved_draft_so_far = args[:4]

    cache_summary = _load_cache_summary()
    prompt = f"""你是一位中文长篇小说作者，请基于以下信息继续写作。

【故事大纲】
{outline or "无"}

【参考设定/文风参考】
{reference or "无"}

【写作要求】
{requirements or "无"}

【字数设定】
{resolved_word_target or "无"}

【补充设定】
{resolved_extra_settings or "无"}

【全局记忆】
{resolved_global_memory or "无"}

【已完成章节摘要】
{cache_summary}

【当前已写草稿】
{resolved_draft_so_far or "（暂无）"}

请严格输出约{CHARS_PER_BATCH}字中文小说正文，要求：
1. 只输出正文内容，不要标题、编号、解释、注释、前言、后记。
2. 保持情节连贯、人物行为一致、语言自然。
3. 尽量形成完整的叙事推进与情绪起伏。
4. 不要使用Markdown格式，不要代码块，不要多余说明。
5. 注意根据语义和段意合理分段，每段200-400字为宜，段落之间用空行分隔。
"""

    if on_progress:
        on_progress("", THINKING_PHASES[0][1])

    ok, raw, err = _run_prompt_with_progress(
        prompt,
        on_progress,
        should_stop=should_stop,
        on_process_start=on_process_start,
        on_process_end=on_process_end,
        reasoning_effort_override=reasoning_effort,
    )
    if not ok:
        return {"success": False, "content": "", "error": err}

    content = _clean_generated_text(raw)
    if not content:
        return {"success": False, "content": "", "error": "生成结果为空"}
    return {"success": True, "content": content, "error": None}


def generate_chapter_title(chapter_content):
    content = (chapter_content or "").strip()
    if not content:
        return {"success": False, "title": "", "error": "章节内容为空"}

    if len(content) <= 1000:
        summary = content
    else:
        summary = f"{content[:500]}\n...\n{content[-500:]}"

    prompt = f"""你是中文小说编辑，请为章节拟一个简洁有吸引力的标题。

【章节摘要（节选）】
{summary}

要求：
1. 标题为4到10个中文字符。
2. 不要标点符号，不要引号，不要"第X章"。
3. 只输出标题本身，不要任何解释。
"""

    ok, raw, err = _run_prompt(prompt)
    if not ok:
        return {"success": False, "title": "", "error": err}

    title = _clean_title(raw)
    if not title:
        return {"success": False, "title": "", "error": "标题生成失败"}
    return {"success": True, "title": title, "error": None}


_MEMORY_LINE_RE = re.compile(r"^\s*([^|｜]+)\s*[|｜]\s*([^|｜]+)\s*[|｜]\s*(.+?)\s*$")
_MEMORY_COLON_RE = re.compile(r"^\s*([^：:]+)\s*[：:]\s*([^：:]+)\s*[：:]\s*(.+?)\s*$")
_MEMORY_TYPES = {"人物", "地点", "组织", "物品", "设定", "事件"}


def _clean_memory_text_part(value, max_len):
    x = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    x = re.sub(r"\s+", " ", x)
    x = x.replace("|", "／").replace("｜", "／")
    if len(x) > max_len:
        x = x[:max_len]
    return x


def _normalize_memory_type(value):
    t = _clean_memory_text_part(value, 10)
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
    if t not in _MEMORY_TYPES:
        t = "设定"
    return t


def _normalize_memory_item(memory_type, name, summary):
    normalized = {
        "type": _normalize_memory_type(memory_type),
        "name": _clean_memory_text_part(name, 30),
        "summary": _clean_memory_text_part(summary, 220),
    }
    if not normalized["name"] or not normalized["summary"]:
        return None
    return normalized


def _parse_memory_updates_from_json(text):
    raw = str(text or "").strip()
    if not raw:
        return []

    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()

    candidates = [raw]
    m = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
    if m:
        candidates.append(m.group(1))

    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except Exception:
            continue

        items = []
        if isinstance(data, dict):
            if isinstance(data.get("items"), list):
                items = data.get("items")
            elif isinstance(data.get("memories"), list):
                items = data.get("memories")
            else:
                # Accept single object.
                items = [data]
        elif isinstance(data, list):
            items = data

        parsed = []
        seen = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_memory_item(
                item.get("type", item.get("kind", "设定")),
                item.get("name", item.get("entity", "")),
                item.get("summary", item.get("content", item.get("value", ""))),
            )
            if not normalized:
                continue
            key = (
                normalized["type"].casefold(),
                re.sub(r"\s+", "", normalized["name"]).casefold(),
            )
            if key in seen:
                continue
            seen.add(key)
            parsed.append(normalized)
        if parsed:
            return parsed

    return []


def _parse_memory_updates_text(text):
    json_items = _parse_memory_updates_from_json(text)
    if json_items:
        return json_items

    parsed = []
    seen = set()
    for raw_line in str(text or "").replace("\r\n", "\n").split("\n"):
        line = raw_line.strip().strip("`")
        if not line:
            continue
        if line.lower().startswith("json"):
            continue
        line = re.sub(r"^[\-\*\+\d\.\)\(、\s]+", "", line)
        m = _MEMORY_LINE_RE.match(line)
        if not m:
            m = _MEMORY_COLON_RE.match(line)
        if not m:
            continue

        normalized = _normalize_memory_item(m.group(1), m.group(2), m.group(3))
        if not normalized:
            continue

        key = (
            normalized["type"].casefold(),
            re.sub(r"\s+", "", normalized["name"]).casefold(),
        )
        if key in seen:
            continue
        seen.add(key)
        parsed.append(normalized)
    return parsed


def extract_global_memory_updates(chapter_text, global_memory):
    chapter = str(chapter_text or "").strip()
    if not chapter:
        return {"success": True, "items": [], "error": None}

    prompt = f"""你是小说连贯性编辑，请根据“本章正文”输出需要写入全局记忆的更新条目。

目标：
1. 只输出“新增或需要覆盖旧信息”的条目。
2. 如果本章修正了旧信息，请输出同一“类型+名称”的新条目，用于替换旧条目。
3. 每条必须有助于后续章节保持人物、地点、关系与状态的一致性。

输出格式（严格）：
每行一条：类型|名称|要点
类型只能是：人物、地点、组织、物品、设定、事件
不要输出任何解释、序号、Markdown、代码块。

【已有全局记忆】
{global_memory or "无"}

【本章正文】
{chapter}
"""

    ok, raw, err = _run_prompt(prompt)
    if not ok:
        return {"success": False, "items": [], "error": err or "记忆提取失败"}

    items = _parse_memory_updates_text(raw)
    if not items:
        return {"success": False, "items": [], "error": "记忆提取结果为空或格式不匹配"}

    return {"success": True, "items": items, "error": None}


def extract_structured_memory_updates(
    chapter_text,
    global_memory_structured="",
    global_memory_text="",
):
    chapter = str(chapter_text or "").strip()
    if not chapter:
        return {"success": True, "items": [], "error": None}

    structured_blob = ""
    try:
        if isinstance(global_memory_structured, (dict, list)):
            structured_blob = json.dumps(global_memory_structured, ensure_ascii=False)
        else:
            structured_blob = str(global_memory_structured or "")
    except Exception:
        structured_blob = str(global_memory_structured or "")

    prompt = f"""你是小说全局记忆维护助手。请根据“本章正文”抽取“新增或更新”的结构化记忆。

目标：
1. 仅输出新增或变更项；若与旧信息冲突，输出新值用于覆盖。
2. 结果必须可用于后续保持人物、地点、状态、关系的一致性。
3. 严格输出 JSON，不要解释、不要 Markdown、不要代码块。

JSON 格式（严格）：
{{
  "人物": [{{"name":"名称","summary":"当前状态/关键信息"}}],
  "地点": [{{"name":"地点名","summary":"地点特征/当前情况"}}],
  "状态": [{{"name":"状态名","summary":"当前描述"}}],
  "关系": [{{"name":"关系主体","summary":"关系变化或稳定关系"}}]
}}

约束：
- 仅允许这四个顶层键：人物、地点、状态、关系。
- 每个数组项都必须包含 name 与 summary。
- name 精炼，summary 不超过120字。

【已有结构化记忆】
{structured_blob or "无"}

【已有文本记忆】
{global_memory_text or "无"}

【本章正文】
{chapter}
"""

    ok, raw, err = _run_prompt(prompt)
    if not ok:
        return {"success": False, "items": [], "error": err or "结构化记忆提取失败"}

    blob = _extract_first_json_object(raw)
    if not blob:
        return {"success": False, "items": [], "error": "结构化记忆结果无法解析为 JSON"}

    try:
        data = json.loads(blob)
    except Exception:
        return {"success": False, "items": [], "error": "结构化记忆 JSON 解析失败"}

    categories = ("人物", "地点", "状态", "关系")
    items = []
    seen = set()
    for category in categories:
        rows = data.get(category, [])
        if not isinstance(rows, list):
            continue
        for row in rows[:200]:
            if not isinstance(row, dict):
                continue
            normalized = _normalize_memory_item(
                category,
                row.get("name", ""),
                row.get("summary", ""),
            )
            if not normalized:
                continue
            # Keep type as structured category.
            normalized["type"] = category
            key = (
                normalized["type"].casefold(),
                re.sub(r"\s+", "", normalized["name"]).casefold(),
            )
            if key in seen:
                continue
            seen.add(key)
            items.append(normalized)

    if not items:
        return {"success": False, "items": [], "error": "结构化记忆提取结果为空"}
    return {"success": True, "items": items, "error": None}


def check_chapter_consistency(
    chapter_text,
    global_memory="",
    outline="",
    reference="",
    requirements="",
    word_target="",
    extra_settings="",
):
    chapter = str(chapter_text or "").strip()
    if not chapter:
        return {
            "success": False,
            "has_conflicts": False,
            "conflicts": [],
            "summary": "",
            "error": "章节内容为空",
        }

    prompt = f"""你是小说一致性审校助手。请检查“本章正文”与既有设定是否冲突，重点关注：
1. 人设与行为逻辑（人物性格、能力、关系）
2. 时间线（前后顺序、时长、事件先后）
3. 地点与空间逻辑（人物是否可能同时出现在不合理地点）

请严格只输出 JSON，不要任何解释或代码块，格式如下：
{{
  "has_conflicts": true/false,
  "summary": "一句话总结",
  "conflicts": [
    {{
      "type": "人设|时间线|地点|其他",
      "issue": "冲突描述",
      "evidence": "冲突依据（可简短）",
      "suggestion": "可执行修复建议"
    }}
  ]
}}

当没有冲突时，conflicts 输出空数组。

【故事大纲】
{outline or "无"}

【参考设定/文风参考】
{reference or "无"}

【写作要求】
{requirements or "无"}

【字数设定】
{word_target or "无"}

【补充设定】
{extra_settings or "无"}

【全局记忆】
{global_memory or "无"}

【本章正文】
{chapter}
"""

    ok, raw, err = _run_prompt(prompt)
    if not ok:
        return {
            "success": False,
            "has_conflicts": False,
            "conflicts": [],
            "summary": "",
            "error": err or "一致性检查失败",
        }

    blob = _extract_first_json_object(raw)
    if not blob:
        return {
            "success": False,
            "has_conflicts": False,
            "conflicts": [],
            "summary": "",
            "error": "一致性检查结果无法解析为 JSON",
        }

    try:
        data = json.loads(blob)
    except Exception:
        return {
            "success": False,
            "has_conflicts": False,
            "conflicts": [],
            "summary": "",
            "error": "一致性检查 JSON 解析失败",
        }

    has_conflicts = bool(data.get("has_conflicts", False))
    summary = str(data.get("summary", "") or "").strip()
    raw_conflicts = data.get("conflicts", [])
    conflicts = []
    if isinstance(raw_conflicts, list):
        for item in raw_conflicts[:12]:
            if not isinstance(item, dict):
                continue
            ctype = str(item.get("type", "其他") or "其他").strip() or "其他"
            issue = str(item.get("issue", "") or "").strip()
            evidence = str(item.get("evidence", "") or "").strip()
            suggestion = str(item.get("suggestion", "") or "").strip()
            if not issue:
                continue
            conflicts.append(
                {
                    "type": ctype,
                    "issue": issue,
                    "evidence": evidence,
                    "suggestion": suggestion,
                }
            )

    if conflicts:
        has_conflicts = True
    elif has_conflicts:
        has_conflicts = False

    return {
        "success": True,
        "has_conflicts": has_conflicts,
        "conflicts": conflicts,
        "summary": summary,
        "error": None,
    }
