param(
  [string]$InstallDir = "",
  [string]$AppExe = ""
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
  param([string]$Message)
  Write-Host "[NNovel Setup] $Message"
}

function Show-Warn {
  param([string]$Message, [string]$Title = "NNovel 安装")
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
  [void][System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
}

function Confirm-YesNoChoice {
  param(
    [string]$Message,
    [string]$Title = "NNovel 安装",
    [bool]$DefaultYes = $false
  )
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
  $defaultButton = if ($DefaultYes) {
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1
  } else {
    [System.Windows.Forms.MessageBoxDefaultButton]::Button2
  }
  $result = [System.Windows.Forms.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question,
    $defaultButton
  )
  return $result -eq [System.Windows.Forms.DialogResult]::Yes
}

function Resolve-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return $cmd.Source
  }
  return ""
}

function Find-FirstExistingPath {
  param([string[]]$Candidates)
  foreach ($path in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    if (Test-Path -LiteralPath $path) {
      return $path
    }
  }
  return ""
}

function Test-WingetAvailable {
  return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
  param([string]$PackageId)
  if (-not (Test-WingetAvailable)) {
    return $false
  }

  $wingetInstallArgs = @(
    "install",
    "--id", $PackageId,
    "--exact",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity"
  )

  try {
    $proc = Start-Process -FilePath "winget" -ArgumentList $wingetInstallArgs -Wait -PassThru -WindowStyle Hidden
    return $proc.ExitCode -eq 0
  } catch {
    return $false
  }
}

function Set-UserEnv {
  param([string]$Name, [string]$Value)
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
}

function Initialize-AuthTemplate {
  $runtimeRoot = Join-Path $env:APPDATA "NNovel\runtime"
  New-Item -Path $runtimeRoot -ItemType Directory -Force | Out-Null

  $authPath = Join-Path $runtimeRoot "auth.json"
  if (Test-Path -LiteralPath $authPath) {
    return
  }

  $template = [ordered]@{
    OPENAI_API_KEY = ""
    GEMINI_API_KEY = ""
    GOOGLE_API_KEY = ""
    ANTHROPIC_API_KEY = ""
    PERSONAL_API_KEY = ""
    PERSONAL_BASE_URL = ""
    DOUBAO_API_KEY = ""
    ARK_API_KEY = ""
  }

  $json = $template | ConvertTo-Json -Depth 4
  Set-Content -LiteralPath $authPath -Value $json -Encoding UTF8
  Write-Step "Created auth.json template: $authPath"
}

function Get-PythonCommandInfo {
  $envCmd = [Environment]::GetEnvironmentVariable("NNOVEL_PYTHON_CMD", "User")
  $envArgs = [Environment]::GetEnvironmentVariable("NNOVEL_PYTHON_ARGS", "User")
  if ($envCmd -and (Test-Path -LiteralPath $envCmd)) {
    $resolvedArgs = ""
    if ($null -ne $envArgs) {
      $resolvedArgs = [string]$envArgs
    }
    return @{ Command = $envCmd; Args = $resolvedArgs }
  }

  $py = Resolve-CommandPath "py"
  if ($py) {
    return @{ Command = $py; Args = "-3" }
  }

  $python = Resolve-CommandPath "python"
  if ($python) {
    return @{ Command = $python; Args = "" }
  }

  $fallback = Find-FirstExistingPath @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python313\python.exe"
  )

  if ($fallback) {
    return @{ Command = $fallback; Args = "" }
  }

  return $null
}

function Get-NpmPath {
  $npm = Resolve-CommandPath "npm"
  if ($npm) { return $npm }

  $fallback = Find-FirstExistingPath @(
    "$env:ProgramFiles\nodejs\npm.cmd",
    "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
  )
  return $fallback
}

function Resolve-NodeAndNpm {
  $npm = Get-NpmPath
  if ($npm) {
    return $npm
  }

  Write-Step "Node.js/npm not found. Attempting install with winget."
  $ok = Install-WithWinget "OpenJS.NodeJS.LTS"
  if (-not $ok) {
    Show-Warn "未检测到 npm，且自动安装 Node.js 失败。`n请手动安装 Node.js LTS 后再安装 CLI。"
    return ""
  }

  Start-Sleep -Milliseconds 1000
  $npm = Get-NpmPath
  if (-not $npm) {
    Show-Warn "Node.js 安装后仍未检测到 npm。请重启系统后再试。"
    return ""
  }

  return $npm
}

function Resolve-CliPath {
  param([string]$Command, [string[]]$Fallbacks)

  $path = Resolve-CommandPath $Command
  if ($path) { return $path }

  return Find-FirstExistingPath $Fallbacks
}

function Install-CliIfWanted {
  param(
    [string]$DisplayName,
    [string]$Command,
    [string]$PackageName,
    [string]$EnvVar,
    [string[]]$Fallbacks,
    [string]$ManualCommand
  )

  $existing = Resolve-CliPath -Command $Command -Fallbacks $Fallbacks
  if ($existing) {
    Set-UserEnv -Name $EnvVar -Value $existing
    Write-Step "$DisplayName already available: $existing"
    return
  }

  $wantInstall = Confirm-YesNoChoice -Message "未检测到 $DisplayName。`n是否现在安装？" -Title "NNovel - 可选 CLI 安装"
  if (-not $wantInstall) {
    Write-Step "Skip install: $DisplayName"
    return
  }

  $npm = Resolve-NodeAndNpm
  if (-not $npm) {
    return
  }

  Write-Step "Installing $DisplayName via npm: $PackageName"
  try {
    $proc = Start-Process -FilePath $npm -ArgumentList @("install", "-g", $PackageName, "--loglevel=error") -Wait -PassThru -WindowStyle Hidden
    if ($proc.ExitCode -ne 0) {
      Show-Warn "$DisplayName 自动安装失败（退出码: $($proc.ExitCode)）。`n可手动执行：`n$ManualCommand"
      return
    }
  } catch {
    Show-Warn "$DisplayName 自动安装失败。`n可手动执行：`n$ManualCommand"
    return
  }

  Start-Sleep -Milliseconds 600
  $resolved = Resolve-CliPath -Command $Command -Fallbacks $Fallbacks
  if ($resolved) {
    Set-UserEnv -Name $EnvVar -Value $resolved
    Write-Step "$DisplayName installed: $resolved"
  } else {
    Show-Warn "$DisplayName 安装完成后未检测到命令路径。`n可手动执行：`n$ManualCommand"
  }
}

Write-Step "Post-install start"

Initialize-AuthTemplate

$pythonInfo = Get-PythonCommandInfo
if (-not $pythonInfo) {
  Write-Step "Python not found. Installing Python 3.12 via winget."
  $ok = Install-WithWinget "Python.Python.3.12"
  if ($ok) {
    Start-Sleep -Milliseconds 1000
    $pythonInfo = Get-PythonCommandInfo
  }
}

if ($pythonInfo) {
  Set-UserEnv -Name "NNOVEL_PYTHON_CMD" -Value $pythonInfo.Command
  Set-UserEnv -Name "NNOVEL_PYTHON_ARGS" -Value $pythonInfo.Args
  Write-Step "Python command set: $($pythonInfo.Command) $($pythonInfo.Args)"
} else {
  Show-Warn "未检测到 Python，且自动安装失败。`nNNovel 后端依赖 Python，请先安装 Python 3.12+ 再启动。"
}

Install-CliIfWanted -DisplayName "OpenAI Codex CLI" -Command "codex" -PackageName "@openai/codex" -EnvVar "NNOVEL_CODEX_CMD" -Fallbacks @("$env:APPDATA\npm\codex.cmd") -ManualCommand "npm install -g @openai/codex"
Install-CliIfWanted -DisplayName "Google Gemini CLI" -Command "gemini" -PackageName "@google/gemini-cli" -EnvVar "NNOVEL_GEMINI_CMD" -Fallbacks @("$env:APPDATA\npm\gemini.cmd") -ManualCommand "npm install -g @google/gemini-cli"
Install-CliIfWanted -DisplayName "Anthropic Claude CLI" -Command "claude" -PackageName "@anthropic-ai/claude-code" -EnvVar "NNOVEL_CLAUDE_CMD" -Fallbacks @("$env:APPDATA\npm\claude.cmd") -ManualCommand "npm install -g @anthropic-ai/claude-code"

Write-Step "Post-install completed"

