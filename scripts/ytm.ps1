# SPARK → YouTube Music (Chrome ile kurulmuş masaüstü uygulaması / PWA) köprüsü.
# main.js bu betiği PowerShell ile çalıştırır; çıktı tek satırlık durum metnidir.
#
#   -Mode open  : -Url'yi YouTube Music penceresinde açar (-Shuffle ile liste "karışık çal" ile başlar)
#   -Mode key   : Windows medya tuşu gönderir (-Key play_pause|next|previous|stop|volume_up|volume_down|mute)
#
# Neden böyle: YouTube Music'in resmi bir kontrol API'si yok. Açık uygulama penceresine adres vermenin tek
# yolu Chrome'un PWA "kısayol menüsü" anahtarı; bu her seferinde yeni pencere açtığı için eski YouTube Music
# pencereleri yenisi açılınca kapatılır (sonuçta yine tek pencere kalır). Çal/Karışık çal düğmelerine
# Windows UI Automation ile basılır (Chrome sayfa içeriğini erişilebilirlik ağacıyla sunar).
param(
  [string]$Mode = 'open',
  [string]$Url = '',
  [string]$Exe = '',
  [string]$ProfileDir = 'Default',
  [string]$AppId = '',
  [string]$Key = '',
  [switch]$Shuffle
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class YtmWin {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Başlığı "YouTube Music" ile biten Chrome pencereleri (uygulama penceresi; sekmeler "- Google Chrome" ile biter)
  public static List<long> Windows() {
    var r = new List<long>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "Chrome_WidgetWin_1") return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      var s = t.ToString();
      // Uygulama penceresinin başlığı "YouTube Music", "Şarkı | YouTube Music" ya da "YouTube Music - Sayfa" olabilir
      if (!s.EndsWith("Google Chrome") && (s.StartsWith("YouTube Music") || s.EndsWith("YouTube Music"))) r.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@

function Find-Button([System.Windows.Automation.AutomationElement]$root, [string]$pattern, [bool]$exact = $false) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  foreach ($b in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
    $n = $b.Current.Name
    if (-not $n) { continue }
    if ($exact) { if ($n -eq $pattern) { return $b } } elseif ($n -match $pattern) { return $b }
  }
  return $null
}
function Press([System.Windows.Automation.AutomationElement]$el) {
  $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

if ($Mode -eq 'key') {
  $map = @{ play_pause = 0xB3; next = 0xB0; previous = 0xB1; stop = 0xB2; volume_up = 0xAF; volume_down = 0xAE; mute = 0xAD }
  if (-not $map.ContainsKey($Key)) { Write-Output "hata: bilinmeyen tus $Key"; exit 1 }
  $vk = [byte]$map[$Key]
  $times = if ($Key -like 'volume_*') { 5 } else { 1 }   # ses tuşu bir basışta %2 değiştirir; 5 basış ≈ %10
  for ($i = 0; $i -lt $times; $i++) {
    [YtmWin]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    [YtmWin]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
  }
  Write-Output 'ok'
  exit 0
}

# --- open ---
if (-not $Url) { Write-Output 'hata: adres yok'; exit 1 }
$before = [YtmWin]::Windows()
Start-Process -FilePath $Exe -ArgumentList @("--profile-directory=$ProfileDir", "--app-id=$AppId", "--app-launch-url-for-shortcuts-menu-item=$Url")

$new = $null
for ($i = 0; $i -lt 80; $i++) {
  Start-Sleep -Milliseconds 150
  $n = [YtmWin]::Windows() | Where-Object { $before -notcontains $_ } | Select-Object -First 1
  if ($n) { $new = $n; break }
}
if (-not $new) { Write-Output 'pencere-yok'; exit 0 }

# Yeni pencere açıldı: eski YouTube Music pencereleri kapatılır (çalan müzik de onlarla kesilir)
foreach ($try in 1..4) {
  $left = [YtmWin]::Windows() | Where-Object { $before -contains $_ }
  if (-not $left) { break }
  foreach ($h in $left) { [void][YtmWin]::PostMessage([IntPtr]$h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
  Start-Sleep -Milliseconds 700
}
[void][YtmWin]::SetForegroundWindow([IntPtr]$new)

# Sayfa yüklenince düğmelere bas. İlk sorgu Chrome'un erişilebilirlik ağacını açar; içerik birkaç saniye sonra görünür.
# Liste (-Shuffle): sayfadaki "<liste adı> adlı içeriği oynat" düğmesi çalmayı başlatır, sonra oynatıcıdaki
#   "Karıştır" düğmesine bir kez basılır (YouTube Music web'te bu düğme sırayı karıştıran bir eylemdir).
# Şarkı: otomatik başlamadıysa "Oynat" düğmesine basılır.
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$new)
[void](Find-Button $root '^$')
$result = 'acildi'
$started = $false
$deadline = (Get-Date).AddSeconds(18)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 450
  try {
    if ($Shuffle) {
      if (-not $started) {
        $cond = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
        foreach ($b in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
          $n = $b.Current.Name
          # liste başlığındaki oynat düğmesi (parça satırlarında "- 3 dakika 5 saniye" süresi geçer)
          if ($n -like '* adlı içeriği oynat' -and $n -notmatch 'd+ (dakika|saniye)') { Press $b; $started = $true; $result = 'basladi'; break }
        }
      } else {
        $s = Find-Button $root 'Karıştır' $true
        if ($s) { Press $s; $result = 'karisik'; break }
      }
    } else {
      if (Find-Button $root 'Duraklat' $true) { $result = 'caliyor'; break }
      $p = Find-Button $root 'Oynat' $true
      if ($p) { Press $p; $result = 'oynatildi'; break }
    }
  } catch { }
}
Write-Output $result
