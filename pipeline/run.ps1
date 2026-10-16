# pipeline/run.ps1
# AppSeeker 数据管道主入口：采集 → 清洗 → 评分 → 输出（每日 2 次由计划任务触发）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File pipeline\run.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File pipeline\run.ps1 -Source csv

param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Source = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$startedAt = Get-Date
$configPath = Join-Path $ProjectRoot 'config.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw "未找到 config.json：$configPath" }

$configObj = (Get-Content -LiteralPath $configPath -Raw -Encoding UTF8) | ConvertFrom-Json
$config = @{}
foreach ($p in $configObj.PSObject.Properties) { $config[$p.Name] = $p.Value }
if (-not [string]::IsNullOrWhiteSpace($Source)) { $config['source'] = $Source }

. (Join-Path $PSScriptRoot 'adapters.ps1')
. (Join-Path $PSScriptRoot 'scoring.ps1')

$statTime = Get-Date
$rowsIn   = 0
$status   = 'success'
$errMsg   = ''
$result   = $null

try {
  # 1) 采集
  $raw = @(Get-RawRankings -Config $config -ProjectRoot $ProjectRoot -StatTime $statTime)
  $rowsIn = $raw.Count
  if ($rowsIn -eq 0) { throw '数据源返回 0 条记录（可检查 config.json 的 source / compliance.killSwitch / inbox 目录）' }

  # 2) 清洗
  $clean = @(Invoke-CleanData -Records $raw -Config $config -StatTime $statTime)
  if ($clean.Count -eq 0) { throw '清洗后无有效记录' }

  # 3) 读取上一次快照，用于计算排名变化
  $prevRank = @{}
  $snapDir = Join-Path $ProjectRoot 'data\snapshots'
  if (Test-Path -LiteralPath $snapDir) {
    $prev = Get-ChildItem -LiteralPath $snapDir -Filter *.json -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notlike 'latest-pointer*' } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($prev) {
      try {
        $po = (Get-Content -LiteralPath $prev.FullName -Raw -Encoding UTF8) | ConvertFrom-Json
        foreach ($a in $po.apps) { $prevRank[$a.id] = [int]$a.rank_no }
      } catch { Write-Warning "上一次快照解析失败，排名变化将显示为 0：$($_.Exception.Message)" }
    }
  }

  # 4) 评分与筛选
  $scored = @(Invoke-ScoreData -Clean $clean -Config $config -PrevRank $prevRank)

  # 5) 首次运行：回填历史，保证详情页趋势可用
  $seeds = $null
  $histPath = Join-Path $ProjectRoot 'public\data\history.json'
  if ((-not (Test-Path -LiteralPath $histPath)) -and ("$($config.source)" -eq 'demo')) {
    $seeds = Get-DemoHistory -Config $config -Records $clean -Days ([int]$config.historyDays)
  }

  # 6) 输出到网站
  $result = Invoke-WriteSiteData -Apps $scored -Config $config -ProjectRoot $ProjectRoot -StatTime $statTime -HistorySeeds $seeds
}
catch {
  $status = 'failed'
  $errMsg = $_.Exception.Message
}

# ---------- 任务日志（对应 PRD log_crawl_job） ----------
$logDir = Join-Path $ProjectRoot 'data\logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$job = [pscustomobject]@{
  job_id     = ([guid]::NewGuid().ToString('N').Substring(0, 12))
  started_at = $startedAt.ToString('yyyy-MM-dd HH:mm:ss')
  ended_at   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  status     = $status
  source     = "$($config.source)"
  rows_in    = $rowsIn
  rows_ok    = if ($result) { $result.meta.total_rows } else { 0 }
  flagged    = if ($result) { $result.flagged } else { 0 }
  stat_time  = if ($result) { $result.meta.stat_time } else { '' }
  snapshot   = if ($result) { $result.snapshot } else { '' }
  error_msg  = $errMsg
}
$jobJson = $job | ConvertTo-Json -Depth 5
Write-TextNoBom -Path (Join-Path $logDir 'last-run.json') -Text $jobJson
Write-TextNoBom -Path (Join-Path $logDir ('run-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.json')) -Text $jobJson

if ($status -ne 'success') {
  Write-Host "[AppSeeker] 更新失败：$errMsg" -ForegroundColor Red
  exit 1
}

Write-Host ("[AppSeeker] 更新完成 · 统计时点 {0} · 覆盖 {1} 平台 · 记录 {2} 条 · 反差命中 {3} 条 · 快照 {4}" -f `
  $result.meta.stat_time, $result.meta.platforms.Count, $result.meta.total_rows, $result.flagged, $result.snapshot) -ForegroundColor Green
exit 0
