# pipeline/adapters.ps1
# 数据源适配器：每个适配器返回「原始记录」数组（字段见 PRD 3.3）。
# 原始记录字段：platform, external_id, name, developer, category, rank_no,
#              download_display, rating_positive, rating_total, rating_avg,
#              comment_count, source_url
#
# 说明：
#   demo    —— 模拟数据源，确定性生成，零依赖，保证开箱即跑（默认）
#   csv     —— 读取 inbox/*.csv，对接真实数据（推荐的真实数据入口）
#   wechat  —— 公开榜单页适配器（占位实现，需完成合规评审与端点配置后启用）
#   alipay  —— 同上

$script:CategoryPool = @('工具','生活服务','内容资讯','电商','教育','游戏','金融','出行','医疗健康','社交')

# ---------- 确定性哈希（替代随机数，保证多次运行结果可复现） ----------
function Get-FnvHash {
  param([string]$Key)
  # 31-based rolling hash with modulus: keeps arithmetic inside Int64, no overflow.
  $h = [long]2166136261
  foreach ($ch in ([string]$Key).ToCharArray()) {
    $h = ($h * 31 + [long][int][char]$ch) % [long]2147483647
  }
  if ($h -lt 0) { $h = -$h }
  return [int]$h
}

function Get-Hash01 {
  param([string]$Key)
  return ((Get-FnvHash -Key $Key) % 10000) / 10000.0
}

function Get-HashInt {
  param([string]$Key, [int]$Min, [int]$Max)
  $v = Get-Hash01 -Key $Key
  return [int][math]::Floor($Min + $v * ($Max - $Min + 1))
}

# ---------- 命名生成 ----------
$script:NamePrefix = @('极速','超级','智能','万能','一键','口袋','闪电','轻量','全民','每日','随手','超值')
$script:NameCore   = @('扫描','记账','天气','快递','翻译','日程','工具箱','相机','音乐','阅读','健康','打卡','步数','图片','文件','团购','点餐','打车','影票','缴费','课程','题库','单词','论坛','社区','直播','商城','优惠','招聘','房产','资讯','笔记')
$script:NameSuffix = @('助手','大全','宝','通','Pro','极速版','管家','专家','圈','社')
$script:DevPrefix  = @('星辰','云图','极目','蓝鲸','天穹','方寸','和光','同尘','数联','声动','跃迁','青柚')
$script:DevSuffix  = @('科技','网络','信息技术','数字科技','工作室','软件')

$script:SuffixByCat = @{
  '工具'     = '助手'
  '生活服务' = '生活'
  '内容资讯' = '资讯'
  '电商'     = '商城'
  '教育'     = '课堂'
  '游戏'     = '乐园'
  '金融'     = '钱包'
  '出行'     = '出行'
  '医疗健康' = '健康'
  '社交'     = '圈'
}

# ---------- demo 适配器 ----------
# game-style naming pools (used by html5-like platforms)
$script:GameCategoryPool = @('休闲益智','动作冒险','射击飞行','竞速体育','模拟经营','角色扮演','策略塔防','棋牌')
$script:GamePrefix = @('疯狂','超能','传奇','全民','火柴人','像素','萌宠','机甲','荒野','热血')
$script:GameCore   = @('消除','闯关','跑酷','射击','塔防','拼图','模拟','找茬','合成','跳跃','赛车','弹球','答题','冒险')
$script:GameSuffix = @('大作战','王者','传奇','英雄传','大冒险','达人','大师','之战','世界','高手')

function Get-DemoRecord {
  param([string]$PlatformCode, [int]$Index, [datetime]$StatTime)
  $key = "$PlatformCode-$Index"
  # 游戏类平台（html5 等）使用独立的名称与品类词库，避免出现「极速扫描助手」这类违和命名
  $isGame = ($PlatformCode -in @('html5','wxgame','dygame'))
  $catPool = if ($isGame) { $script:GameCategoryPool } else { $script:CategoryPool }
  $pPool   = if ($isGame) { $script:GamePrefix }       else { $script:NamePrefix }
  $cPool   = if ($isGame) { $script:GameCore }         else { $script:NameCore }
  $sPool   = if ($isGame) { $script:GameSuffix }       else { $script:NameSuffix }

  $cat = $catPool[(Get-FnvIntSafe -Key "$key-cat" -Mod $catPool.Count)]

  $name = ($pPool[(Get-FnvIntSafe -Key "$key-p" -Mod $pPool.Count)]) +
          ($cPool[(Get-FnvIntSafe -Key "$key-c" -Mod $cPool.Count)]) +
          ($sPool[(Get-FnvIntSafe -Key "$key-s" -Mod $sPool.Count)])

  $dev = ($script:DevPrefix[(Get-FnvIntSafe -Key "$key-d" -Mod $script:DevPrefix.Count)]) +
         ($script:DevSuffix[(Get-FnvIntSafe -Key "$key-e" -Mod $script:DevSuffix.Count)])

  # 下载量分档（幂律：高下载是少数）
  $s = Get-Hash01 -Key "$key-dl"
  $tier = '1万+'
  if      ($s -gt 0.985) { $tier = '1000万+' }
  elseif  ($s -gt 0.94)  { $tier = '500万+' }
  elseif  ($s -gt 0.84)  { $tier = '100万+' }
  elseif  ($s -gt 0.66)  { $tier = '50万+' }
  elseif  ($s -gt 0.42)  { $tier = '10万+' }
  elseif  ($s -gt 0.18)  { $tier = '5万+' }

  # 评价样本量：与下载量正相关
  $reviewScale = 1.0
  switch ($tier) {
    '1000万+' { $reviewScale = 220 } '500万+' { $reviewScale = 120 }
    '100万+'  { $reviewScale = 60 }  '50万+'  { $reviewScale = 30 }
    '10万+'   { $reviewScale = 12 }  '5万+'   { $reviewScale = 6 }
    default   { $reviewScale = 2 }
  }
  $ratingTotal = [int]([math]::Round(($reviewScale * 40) * (0.5 + (Get-Hash01 -Key "$key-rt") * 1.8)))
  if ($ratingTotal -lt 12) { $ratingTotal = 12 }

  # 好评率：0.34 ~ 0.98，且高下载者倾向更低（制造反差样本）
  $dlPressure = 0.0
  if ($tier -eq '1000万+') { $dlPressure = 0.18 } elseif ($tier -eq '500万+') { $dlPressure = 0.14 }
  elseif ($tier -eq '100万+') { $dlPressure = 0.10 } elseif ($tier -eq '50万+') { $dlPressure = 0.06 }

  # 游戏类的差评驱动因素不同（广告过多 / 难度不合理 / 卡关），整体口碑再压低一档
  if ($isGame) { $dlPressure += 0.07 }

  $pr = 0.98 - (Get-Hash01 -Key "$key-pr") * 0.60 - $dlPressure
  if ($pr -lt 0.30) { $pr = 0.30 }
  if ($pr -gt 0.985) { $pr = 0.985 }
  $pr = [math]::Round($pr, 4)

  $positive = [int][math]::Round($ratingTotal * $pr)
  $ratingAvg = [math]::Round(1.0 + $pr * 4.0, 2)
  $comments = [int]([math]::Round($ratingTotal * (0.10 + (Get-Hash01 -Key "$key-cc") * 0.35)))

  [pscustomobject]@{
    platform         = $PlatformCode
    external_id      = ('{0:D4}' -f $Index)
    name             = $name
    developer        = $dev
    category         = $cat
    rank_no          = 0
    download_display = $tier
    rating_positive  = $positive
    rating_total     = $ratingTotal
    rating_avg       = $ratingAvg
    comment_count    = $comments
    source_url       = "https://example.com/$PlatformCode/rank"
  }
}

function Get-FnvIntSafe {
  param([string]$Key, [int]$Mod)
  return (Get-FnvHash -Key $Key) % $Mod
}

function Get-DemoRankings {
  param([hashtable]$Config, [datetime]$StatTime)
  $records = New-Object System.Collections.ArrayList
  foreach ($p in $Config.platforms) {
    if (-not $p.enabled) { continue }
    $count = 0
    if ($p.PSObject.Properties.Name -contains 'demoCount') { $count = [int]$p.demoCount }
    if ($count -le 0) { $count = 120 }
    for ($i = 0; $i -lt $count; $i++) {
      [void]$records.Add((Get-DemoRecord -PlatformCode $p.code -Index ($i + 1) -StatTime $StatTime))
    }
  }
  return $records.ToArray()
}

# ---------- demo 历史回填（首次运行时让趋势图有数据） ----------
function Get-DemoHistory {
  param([hashtable]$Config, [array]$Records, [int]$Days)
  $hist = @{}
  $today = (Get-CnNow).Date
  foreach ($r in $Records) {
    $id = "$($r.platform):$($r.external_id)"
    $rate = $r.rating_positive / [double]$r.rating_total
    $pts = New-Object System.Collections.ArrayList
    for ($d = $Days - 1; $d -ge 0; $d--) {
      $date = $today.AddDays(-$d)
      $seed = "$($r.platform)-$($r.external_id)-$($date.ToString('yyyyMMdd'))"
      # 好评率缓慢漂移；下载量对数期缓慢增长
      $drift = (Get-Hash01 -Key $seed) - 0.5
      $prDrift = [math]::Round([math]::Min(0.99, [math]::Max(0.25, $rate + $drift * 0.06 * ($d / [double]$Days) - (Get-Hash01 -Key "$seed-x") * 0.05 * (1 - $d / [double]$Days))), 4)
      $growth = 1.0 - 0.10 * ($d / [double]$Days) + $drift * 0.05
      [void]$pts.Add([pscustomobject]@{
        d  = $date.ToString('yyyy-MM-dd')
        dl = $r.download_display
        pr = $prDrift
        g  = [math]::Round($growth, 4)
      })
    }
    $hist[$id] = $pts.ToArray()
  }
  return $hist
}

# ---------- csv 适配器（真实数据入口） ----------
function Get-CsvRankings {
  param([hashtable]$Config, [string]$InboxDir)
  $records = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $InboxDir)) { return $records.ToArray() }
  $files = Get-ChildItem -LiteralPath $InboxDir -Filter *.csv -File -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    $rows = Import-Csv -LiteralPath $f.FullName -Encoding UTF8
    foreach ($row in $rows) {
      $plat = "$($row.platform)".Trim().ToLower()
      if ([string]::IsNullOrWhiteSpace($plat)) { continue }
      [void]$records.Add([pscustomobject]@{
        platform         = $plat
        external_id      = "$($row.external_id)".Trim()
        name             = "$($row.name)".Trim()
        developer        = "$($row.developer)".Trim()
        category         = "$($row.category)".Trim()
        rank_no          = 0
        download_display = "$($row.download_display)".Trim()
        rating_positive  = [int]("0" + "$($row.rating_positive)".Trim())
        rating_total     = [int]("0" + "$($row.rating_total)".Trim())
        rating_avg       = [double]("0" + "$($row.rating_avg)".Trim())
        comment_count    = [int]("0" + "$($row.comment_count)".Trim())
        source_url       = "$($row.source_url)".Trim()
      })
    }
  }
  return $records.ToArray()
}

# ---------- 真实平台适配器（占位：合规评审通过后再实现） ----------
function Get-PlatformRankings {
  param([string]$PlatformCode, [hashtable]$Config)
  Write-Warning ("[adapter:{0}] 未启用真实抓取。原因：需先完成 robots/ToS 合规评审并配置公开榜单端点；当前返回空集。" -f $PlatformCode)
  return @()
}

# ---------- 统一入口 ----------
function Get-RawRankings {
  param([hashtable]$Config, [string]$ProjectRoot, [datetime]$StatTime)
  if ($Config.compliance.killSwitch) {
    Write-Warning 'compliance.killSwitch = true，已停止采集。'
    return @()
  }
  $source = "$($Config.source)".ToLower()
  switch ($source) {
    'demo'  { return Get-DemoRankings -Config $Config -StatTime $StatTime }
    'csv'   { return Get-CsvRankings  -Config $Config -InboxDir (Join-Path $ProjectRoot 'inbox') }
    default {
      $all = New-Object System.Collections.ArrayList
      foreach ($p in $Config.platforms) {
        if (-not $p.enabled) { continue }
        $recs = Get-PlatformRankings -PlatformCode $p.code -Config $Config
        foreach ($x in $recs) { [void]$all.Add($x) }
      }
      if ($all.Count -eq 0) {
        Write-Warning '真实数据源未返回任何数据，自动回退到 demo 模拟数据源。'
        return Get-DemoRankings -Config $Config -StatTime $StatTime
      }
      return $all.ToArray()
    }
  }
}
