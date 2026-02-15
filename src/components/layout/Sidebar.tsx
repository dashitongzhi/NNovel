import type { AppConfig } from "@/types/domain";
import { ConfigSelect } from "@/components/shared/ConfigSelect";

type ImportTarget = "outline" | "reference";

interface SidebarProps {
  config: AppConfig;
  saving: boolean;
  isWriting: boolean;
  personalConfigReady: boolean;
  onPatch: (patch: Partial<AppConfig>) => void;
  onSave: () => void;
  onStartStop: () => void;
  onOpenSettings: () => void;
  onOpenPersonalConfig: () => void;
  onImportFile: (target: ImportTarget, file: File) => void;
}

function splitModels(text: string): string[] {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/,/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function firstModel(text: string, fallback = ""): string {
  return splitModels(text)[0] || fallback;
}

export function Sidebar(props: SidebarProps) {
  const { config, saving, isWriting, personalConfigReady, onPatch, onSave, onStartStop, onOpenSettings, onOpenPersonalConfig, onImportFile } = props;
  const personalModelsRaw = splitModels(config.personal_models || "");
  const personalModels = personalModelsRaw.length ? personalModelsRaw : ["deepseek-ai/deepseek-v3.2"];
  const doubaoModelsRaw = splitModels(config.doubao_models || "");
  const doubaoModels = doubaoModelsRaw.length ? doubaoModelsRaw : ["doubao-seed-1-6-251015"];

  return (
    <aside id="config-panel" className="sidebar">
      <div className="panel-section">
        <div className="section-header">
          <h3>大纲设定</h3>
          <label className="import-btn" htmlFor="file-outline">导入文件</label>
          <input
            type="file"
            id="file-outline"
            accept=".txt"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportFile("outline", file);
              e.currentTarget.value = "";
            }}
          />
        </div>
        <textarea
          id="outline-input"
          value={config.outline}
          onChange={(e) => onPatch({ outline: e.target.value })}
          placeholder="输入小说大纲..."
        />
      </div>

      <div className="panel-section">
        <div className="section-header">
          <h3>参考文本</h3>
          <label className="import-btn" htmlFor="file-reference">导入文件</label>
          <input
            type="file"
            id="file-reference"
            accept=".txt"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportFile("reference", file);
              e.currentTarget.value = "";
            }}
          />
        </div>
        <textarea
          id="reference-input"
          value={config.reference}
          onChange={(e) => onPatch({ reference: e.target.value })}
          placeholder="输入风格参考或上下文..."
        />
      </div>

      <div className="panel-section">
        <div className="section-header">
          <h3>特殊要求</h3>
        </div>
        <textarea
          id="requirements-input"
          value={config.requirements}
          onChange={(e) => onPatch({ requirements: e.target.value })}
          placeholder="输入本章特殊要求..."
        />
      </div>

      <div className="panel-section">
        <div className="section-header">
          <h3>全局记忆</h3>
        </div>
        <textarea
          id="global_memory-input"
          value={config.global_memory}
          onChange={(e) => onPatch({ global_memory: e.target.value })}
          placeholder="简要记录角色、状态、地名等重要事项，随剧情更新..."
        />
      </div>

      <div className="panel-section">
        <div className="section-header">
          <h3>补充设定</h3>
        </div>
        <textarea
          id="extra_settings-input"
          value={config.extra_settings}
          onChange={(e) => onPatch({ extra_settings: e.target.value })}
          placeholder="输入补充设定..."
        />
      </div>

      <div className="panel-section">
        <div className="section-header">
          <h3>生成引擎</h3>
          <button className="btn btn-primary btn-sm" type="button" onClick={onOpenSettings}>更多设置</button>
        </div>

        <select
          id="engine-mode"
          className="config-input config-select-btn hidden"
          value={config.engine_mode}
          onChange={(e) => onPatch({ engine_mode: e.target.value as AppConfig["engine_mode"] })}
        >
          <option value="codex">ChatGPT</option>
          <option value="gemini">Gemini</option>
          <option value="claude">Claude</option>
          <option value="doubao">Doubao</option>
          <option value="personal">个人配置</option>
        </select>

        <div id="codex-settings" className={config.engine_mode === "codex" ? "" : "hidden"}>
          <ConfigSelect
            id="codex-model-select"
            value={config.codex_model}
            onChange={(value) => onPatch({ codex_model: value })}
            options={[
              { value: "gpt-5.1-codex-mini", label: "GPT-5.1-Mini" },
              { value: "gpt-5.1-codex-max", label: "GPT-5.1-Max" },
              { value: "gpt-5.2", label: "GPT-5.2" },
              { value: "gpt-5.3-codex", label: "GPT-5.3" },
            ]}
          />
          <ConfigSelect
            id="codex-reasoning-select"
            value={config.codex_reasoning_effort}
            onChange={(value) => onPatch({ codex_reasoning_effort: value as AppConfig["codex_reasoning_effort"] })}
            options={[
              { value: "low", label: "思考等级：低" },
              { value: "medium", label: "思考等级：中" },
              { value: "high", label: "思考等级：高" },
            ]}
          />
        </div>

        <div id="gemini-settings" className={config.engine_mode === "gemini" ? "" : "hidden"}>
          <ConfigSelect
            id="gemini-model-select"
            value={config.gemini_model}
            onChange={(value) => onPatch({ gemini_model: value })}
            options={[
              { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
              { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
              { value: "gemini-3-flash", label: "gemini-3-flash" },
              { value: "gemini-3-pro", label: "gemini-3-pro" },
            ]}
          />
          <ConfigSelect
            id="gemini-reasoning-select"
            value={config.gemini_reasoning_effort}
            onChange={(value) => onPatch({ gemini_reasoning_effort: value as AppConfig["gemini_reasoning_effort"] })}
            options={[
              { value: "low", label: "思考等级：低" },
              { value: "medium", label: "思考等级：中" },
              { value: "high", label: "思考等级：高" },
            ]}
          />
        </div>

        <div id="claude-settings" className={config.engine_mode === "claude" ? "" : "hidden"}>
          <ConfigSelect
            id="claude-model-select"
            value={config.claude_model}
            onChange={(value) => onPatch({ claude_model: value })}
            options={[
              { value: "sonnet", label: "sonnet" },
              { value: "opus", label: "opus" },
              { value: "haiku", label: "haiku" },
            ]}
          />
          <ConfigSelect
            id="claude-reasoning-select"
            value={config.claude_reasoning_effort}
            onChange={(value) => onPatch({ claude_reasoning_effort: value as AppConfig["claude_reasoning_effort"] })}
            options={[
              { value: "low", label: "思考等级：低" },
              { value: "medium", label: "思考等级：中" },
              { value: "high", label: "思考等级：高" },
            ]}
          />
        </div>

        <div id="doubao-settings" className={config.engine_mode === "doubao" ? "" : "hidden"}>
          <textarea
            className="config-input"
            style={{ minHeight: 72 }}
            value={config.doubao_models}
            onChange={(e) =>
              onPatch({
                doubao_models: e.target.value,
                doubao_model: firstModel(e.target.value, config.doubao_model),
              })
            }
            placeholder="每行一个 doubao model id"
          />
          <ConfigSelect
            id="doubao-reasoning-select"
            value={config.doubao_reasoning_effort}
            onChange={(value) => onPatch({ doubao_reasoning_effort: value as AppConfig["doubao_reasoning_effort"] })}
            options={[
              { value: "low", label: "思考等级：低" },
              { value: "medium", label: "思考等级：中" },
              { value: "high", label: "思考等级：高" },
            ]}
          />
          <ConfigSelect
            id="doubao-model-select"
            value={config.doubao_model || doubaoModels[0] || ""}
            onChange={(value) => onPatch({ doubao_model: value })}
            options={doubaoModels.map((m) => ({ value: m, label: m }))}
          />
          <div className="config-hint">豆包密钥请通过环境变量设置：DOUBAO_API_KEY 或 ARK_API_KEY</div>
        </div>

        <div id="personal-settings" className={config.engine_mode === "personal" ? "" : "hidden"}>
          <ConfigSelect
            id="personal-model-select"
            value={config.personal_model || personalModels[0] || ""}
            onChange={(value) => onPatch({ personal_model: value })}
            options={personalModels.map((m) => ({ value: m, label: m }))}
          />
          <button id="personal-config-btn" className="btn btn-primary btn-sm" type="button" onClick={onOpenPersonalConfig}>
            打开个人配置
          </button>
          <div className="config-hint">
            状态：
            <span id="personal-config-status" className={personalConfigReady ? "ready" : ""}>
              {personalConfigReady ? "已配置" : "未配置"}
            </span>
          </div>
        </div>
      </div>

      <div className="panel-actions">
        <button id="save-config-btn" className="btn btn-primary" onClick={onSave} disabled={saving} type="button">
          {saving ? "保存中..." : "保存配置"}
        </button>
        <button
          id="sidebar-start-writing-btn"
          className={`btn ${isWriting ? "btn-danger" : "btn-success"}`}
          onClick={onStartStop}
          type="button"
        >
          {isWriting ? "停止写作" : "开始写作"}
        </button>
      </div>
    </aside>
  );
}

