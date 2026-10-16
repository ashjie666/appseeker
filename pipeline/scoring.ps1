# pipeline/scoring.ps1
# 清洗 → 评分 → 筛选 → 输出（对应 PRD 第 3、4 章）

# ---------- 基础工具 ----------
function ConvertTo-HalfWidth {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $Text.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -ge 0xFF01 -and $code -le 0xFF5E) { [void]$sb.Append([char]($code - 0xFEE0)) }
    elseif ($code -eq 0x3000) { [void]$sb.Append(' ') }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}

function Get-NormalizedName {
  param([string]$Name)
  $n = ConvertTo-HalfWidth -Text "$Name"
  $n = $n -replace '\s+', ''
  $n = $n -replace '[（(].*?[）)]', ''
  $n = $n -replace '[「」『』"''·•]', ''
  return $n.Trim()
}

function Convert-DownloadDisplay {
  param([string]$Display)
  $d = ConvertTo-HalfWidth -Text "$Display"
  $d = $d -replace '[,，\s]', ''
  if ([string]::IsNullOrWhiteSpace($d)) { return @{ est = 0; estimated = $true } }

  $isApprox = $false
  if ($d -match '^[<＜]') { $isApprox = $true }
  if ($d -match '\+$')   { $isApprox = $true }
  $d = $d -replace '^[<＜]', '' -replace '\+$', ''

  $mult = 1.0
  if ($d -match '亿') { $mult = 100000000.0 }
  elseif ($d -match '万') { $mult = 10000.0 }
  else { $isApprox = $isApprox }

  $num = $d -replace '亿', '' -replace '万', ''
  $val = 0.0
  $ok = [double]::TryParse($num, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$val)
  if (-not $ok) { $val = 0.0 }
  # 区间值取下界估算；精确值直接使用
  return @{ est = [long][math]::Round($val * $mult); estimated = $isApprox }
}

function Write-TextNoBom {
  param([string]$Path, [string]$Text)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

# ---------- 1. 清洗 ----------
function Invoke-CleanData {
  param([array]$Records, [hashtable]$Config, [datetime]$StatTime)

  $clean = New-Object System.Collections.ArrayList
  $seen = @{}
  $crawlAt = (Get-CnNow).ToString('yyyy-MM-dd HH:mm:ss')

  foreach ($r in $Records) {
    if ($null -eq $r) { continue }
    $plat = "$($r.platform)".Trim().ToLower()
    $extId = "$($r.external_id)".Trim()
    if ([string]::IsNullOrWhiteSpace($plat) -or [string]::IsNullOrWhiteSpace($extId)) { continue }

    $dedupeKey = "$plat|$extId"
    if ($seen.ContainsKey($dedupeKey)) { continue }
    $seen[$dedupeKey] = $true

    $name = Get-NormalizedName -Name "$($r.name)"
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $dl = Convert-DownloadDisplay -Display "$($r.download_display)"
    $total = [int]$r.rating_total
    $positive = [int]$r.rating_positive
    if ($total -lt 0) { $total = 0 }
    if ($positive -lt 0) { $positive = 0 }
    if ($positive -gt $total) { $positive = $total }

    $rate = 0.0
    $quality = 'ok'
    if ($total -gt 0) { $rate = $positive / [double]$total }
    else { $quality = 'derived' }

    $avg = 0.0
    if ($null -ne $r.rating_avg) { [void][double]::TryParse("$($r.rating_avg)", [ref]$avg) }
    if ($avg -le 0) { $avg = [math]::Round(1.0 + $rate * 4.0, 2); if ($quality -eq 'ok') { $quality = 'derived' } }

    # 质量校验：下载量为 0 视为缺失
    if ($dl.est -le 0) { $quality = 'missing' }

    [void]$clean.Add([pscustomobject]@{
      id               = "$plat`:$extId"
      platform         = $plat
      external_id      = $extId
      name             = $name
      developer        = ConvertTo-HalfWidth -Text "$($r.developer)".Trim()
      category         = (ConvertTo-HalfWidth -Text "$($r.category)".Trim())
      download_display = "$($r.download_display)".Trim()
      download_est     = [long]$dl.est
      is_estimated     = [bool]$dl.estimated
      rating_positive  = $positive
      rating_total     = $total
      positive_rate    = [math]::Round($rate, 4)
      rating_avg       = [math]::Round($avg, 2)
      comment_count    = [int]$r.comment_count
      source_url       = "$($r.source_url)".Trim()
      crawl_at         = $crawlAt
      quality_flag     = $quality
    })
  }
  return $clean.ToArray()
}

# ---------- 2. 评分与筛选 ----------
function Invoke-ScoreData {
  param([array]$Clean, [hashtable]$Config, [hashtable]$PrevRank)

  $th = $Config.thresholds
  $result = New-Object System.Collections.ArrayList

  $groups = $Clean | Group-Object -Property { "$($_.platform)|$($_.category)" }
  foreach ($g in $groups) {
    $items = @($g.Group | Sort-Object -Property download_est -Descending)
    $n = $items.Count
    if ($n -eq 0) { continue }

    # 经验分位：降序后第 k 名的分位 = (n-1-k)/(n-1)
    $pctlById = @{}
    for ($k = 0; $k -lt $n; $k++) {
      $p = 1.0
      if ($n -gt 1) { $p = ($n - 1 - $k) / [double]($n - 1) }
      $pctlById[$items[$k].id] = [math]::Round($p, 4)
    }

    # 评论数归一区间
    $lnVals = @($items | ForEach-Object { [math]::Log(1 + $_.comment_count) })
    $lnMin = ($lnVals | Measure-Object -Minimum).Minimum
    $lnMax = ($lnVals | Measure-Object -Maximum).Maximum

    for ($k = 0; $k -lt $n; $k++) {
      $it = $items[$k]
      $rankNo = $k + 1
      $pctl = $pctlById[$it.id]

      $rankScore = 1.0
      if ($n -gt 1) { $rankScore = 1.0 - (($rankNo - 1) / [double]($n - 1)) }

      $lnNorm = 0.5
      if ($lnMax -gt $lnMin) { $lnNorm = ([math]::Log(1 + $it.comment_count) - $lnMin) / ($lnMax - $lnMin) }

      $heat = 100 * (0.60 * $pctl + 0.25 * $rankScore + 0.15 * $lnNorm)
      $rep = 100 * (0.75 * $it.positive_rate + 0.25 * ($it.rating_avg / 5.0))

      $confidence = [math]::Min(1.0, $it.rating_total / 500.0)
      $opp = 100 * $pctl * (1.0 - $it.positive_rate) * $confidence

      # 疑似刷量：下载很高但评价样本极少
      $suspect = $false
      if ($it.download_est -ge 1000000 -and $it.rating_total -lt 30) { $suspect = $true }

      $flag = ($pctl -ge [double]$th.downloadPctl) -and
              ($it.positive_rate -le [double]$th.positiveRateMax) -and
              ($it.rating_total -ge [int]$th.minReviews) -and
              ($it.comment_count -ge [int]$th.minComments) -and
              (-not $suspect)

      $risk = 'low'
      if ($opp -ge 55) { $risk = 'high' } elseif ($opp -ge 30) { $risk = 'mid' }

      $rankChange = 0
      if ($PrevRank -and $PrevRank.ContainsKey($it.id)) { $rankChange = [int]$PrevRank[$it.id] - $rankNo }

      $tags = New-Object System.Collections.ArrayList
      if ($flag) { [void]$tags.Add('机会') }
      if ($it.positive_rate -le 0.55) { [void]$tags.Add('口碑告急') }
      if ($rankChange -ge 8) { [void]$tags.Add('排名跃升') }
      if ($suspect) { [void]$tags.Add('疑似刷量') }

      [void]$result.Add([pscustomobject]@{
        id               = $it.id
        name             = $it.name
        developer        = $it.developer
        category         = $it.category
        platform         = $it.platform
        rank_no          = $rankNo
        rank_change      = $rankChange
        download_display = $it.download_display
        download_est     = [long]$it.download_est
        is_estimated     = $it.is_estimated
        rating_positive  = $it.rating_positive
        rating_total     = $it.rating_total
        positive_rate    = $it.positive_rate
        rating_avg       = $it.rating_avg
        comment_count    = $it.comment_count
        download_pctl    = $pctl
        heat_score       = [math]::Round($heat, 1)
        rep_score        = [math]::Round($rep, 1)
        opportunity_score = [math]::Round($opp, 1)
        flag_high_dl_low_rating = $flag
        risk_level       = $risk
        tags             = $tags.ToArray()
        is_suspect       = $suspect
        source_url       = $it.source_url
        crawl_at         = $it.crawl_at
        quality_flag     = $it.quality_flag
      })
    }
  }
  return $result.ToArray()
}

# ---------- 3. 输出到网站 ----------
function Get-NextUpdateTime {
  param([hashtable]$Config, [datetime]$Now)
  $times = @($Config.schedule.times)
  $cands = New-Object System.Collections.ArrayList
  for ($day = 0; $day -le 1; $day++) {
    foreach ($t in $times) {
      $parts = "$t".Split(':')
      $dt = $Now.Date.AddDays($day).AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
      if ($dt -gt $Now) { [void]$cands.Add($dt) }
    }
  }
  $sorted = @($cands | Sort-Object)
  if ($sorted.Count -eq 0) { return $Now.AddHours(12) }
  return $sorted[0]
}

function Invoke-WriteSiteData {
  param(
    [array]$Apps,
    [hashtable]$Config,
    [string]$ProjectRoot,
    [datetime]$StatTime,
    [hashtable]$HistorySeeds
  )

  $publicData = Join-Path $ProjectRoot 'public\data'
  $now = Get-CnNow
  $floor = [math]::Floor($StatTime.Minute / 5) * 5
  $statLabel = $StatTime.ToString('yyyy-MM-dd ') + ('{0:D2}' -f $StatTime.Hour) + ':' + ('{0:D2}' -f [int]$floor)

  # 平台覆盖统计
  $platforms = New-Object System.Collections.ArrayList
  foreach ($p in $Config.platforms) {
    if (-not $p.enabled) { continue }
    $cnt = @($Apps | Where-Object { "$($_.platform)" -eq "$($p.code)" }).Count
    $metricLabel = '下载量'
    if ($p.PSObject.Properties.Name -contains 'metricLabel') {
      if (-not [string]::IsNullOrWhiteSpace("$($p.metricLabel)")) { $metricLabel = "$($p.metricLabel)" }
    }
    [void]$platforms.Add([pscustomobject]@{ code = $p.code; name = $p.name; count = $cnt; metricLabel = $metricLabel })
  }

  $flagged = @($Apps | Where-Object { $_.flag_high_dl_low_rating })
  $sorted = @($Apps | Sort-Object -Property @{Expression='opportunity_score';Descending=$true}, @{Expression='download_est';Descending=$true})

  $meta = [pscustomobject]@{
    product       = $Config.product
    generated_at  = $now.ToString('yyyy-MM-dd HH:mm:ss')
    stat_time     = $statLabel
    timezone      = $Config.schedule.timezone
    data_source   = $Config.source
    total_rows    = $Apps.Count
    flagged_count = $flagged.Count
    platforms     = $platforms.ToArray()
    next_update   = (Get-NextUpdateTime -Config $Config -Now $now).ToString('yyyy-MM-dd HH:mm')
    schedule_times = @($Config.schedule.times)
    thresholds    = $Config.thresholds
    presets       = $Config.presets
    freshness     = [pscustomobject]@{
      freshHours = $Config.freshness.freshHours
      staleHours = $Config.freshness.staleHours
    }
    disclaimer    = '数据来源于公开榜单 / 模拟示例数据，仅供参考，不构成任何投资建议。'
  }

  $payload = [pscustomobject]@{ meta = $meta; apps = $sorted }

  $json    = $payload    | ConvertTo-Json -Depth 8 -Compress
  $jsonPretty = $payload | ConvertTo-Json -Depth 8
  Write-TextNoBom -Path (Join-Path $publicData 'latest.json') -Text $jsonPretty
  Write-TextNoBom -Path (Join-Path $publicData 'latest.js')   -Text ("window.APPS_DATA = " + $json + ";")

  # ---------- 历史 ----------
  $histPath = Join-Path $publicData 'history.json'
  $history = @{}
  if (Test-Path -LiteralPath $histPath) {
    try {
      $raw = Get-Content -LiteralPath $histPath -Raw -Encoding UTF8
      if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $obj = $raw | ConvertFrom-Json
        foreach ($prop in $obj.PSObject.Properties) { $history[$prop.Name] = @($prop.Value) }
      }
    } catch { $history = @{} }
  }

  $maxPoints = [int]$Config.historyDays * 2 + 4
  foreach ($a in $sorted) {
    $pts = @()
    if ($history.ContainsKey($a.id)) {
      $pts = @($history[$a.id])
    } elseif ($HistorySeeds -and $HistorySeeds.ContainsKey($a.id)) {
      # 首次运行：用确定性回填数据让趋势图有历史
      foreach ($pt in $HistorySeeds[$a.id]) {
        $pts += [pscustomobject]@{
          t  = "$($pt.d) 07:00"
          dl = [long][math]::Round($a.download_est * [double]$pt.g)
          pr = [double]$pt.pr
          g  = 0.0
        }
      }
    }
    $pts += [pscustomobject]@{ t = $statLabel; dl = [long]$a.download_est; pr = [double]$a.positive_rate; g = [double]$a.download_pctl }
    if ($pts.Count -gt $maxPoints) { $pts = @($pts[($pts.Count - $maxPoints)..($pts.Count - 1)]) }
    $history[$a.id] = $pts
  }
  # 清理已不存在的应用记录
  $liveIds = @{}
  foreach ($a in $sorted) { $liveIds[$a.id] = $true }
  foreach ($k in @($history.Keys)) { if (-not $liveIds.ContainsKey($k)) { $history.Remove($k) } }

  $histJson = $history | ConvertTo-Json -Depth 5 -Compress
  $histPretty = $history | ConvertTo-Json -Depth 5
  Write-TextNoBom -Path (Join-Path $publicData 'history.json') -Text $histPretty
  Write-TextNoBom -Path (Join-Path $publicData 'history.js')   -Text ("window.APPS_HISTORY = " + $histJson + ";")

  # ---------- 归档快照 ----------
  $snapDir = Join-Path $ProjectRoot 'data\snapshots'
  if (-not (Test-Path -LiteralPath $snapDir)) { New-Item -ItemType Directory -Force -Path $snapDir | Out-Null }
  $snapName = $now.ToString('yyyyMMdd-HHmm') + '.json'
  Write-TextNoBom -Path (Join-Path $snapDir $snapName) -Text $jsonPretty
  Write-TextNoBom -Path (Join-Path $snapDir 'latest-pointer.json') -Text (@{ file = $snapName } | ConvertTo-Json)

  return [pscustomobject]@{
    meta     = $meta
    flagged  = $flagged.Count
    snapshot = $snapName
    apps     = $sorted
  }
}
