param([Parameter(Mandatory = $true)][string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ComicPickWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
$dialog.Title = '选择图片（按住 Shift 连选，不必全选）'
$dialog.Filter = '图片 (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp'
$dialog.CheckFileExists = $true
$dialog.RestoreDirectory = $true
$owner = New-Object System.Windows.Forms.Form
$owner.Text = '选择图片'
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.FormBorderStyle = 'FixedDialog'
$owner.ShowInTaskbar = $true
$owner.MinimizeBox = $false
$owner.MaximizeBox = $false
$owner.Width = 520
$owner.Height = 150
$label = New-Object System.Windows.Forms.Label
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.Text = "文件窗口会盖在这个窗口前面。`r`n如果没看见，点一下任务栏里的「选择图片」。`r`n按住 Shift 连选，不必全选。"
$owner.Controls.Add($label)
$foreground = [ComicPickWindow]::GetForegroundWindow()
$foregroundThread = [ComicPickWindow]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
$thisThread = [ComicPickWindow]::GetCurrentThreadId()
$attached = $false
if ($foregroundThread -and $foregroundThread -ne $thisThread) {
  $attached = [ComicPickWindow]::AttachThreadInput($thisThread, $foregroundThread, $true)
}
$owner.Show()
$owner.Activate()
[void][ComicPickWindow]::ShowWindow($owner.Handle, 9)
[void][ComicPickWindow]::BringWindowToTop($owner.Handle)
[void][ComicPickWindow]::SetForegroundWindow($owner.Handle)
if ($attached) { [void][ComicPickWindow]::AttachThreadInput($thisThread, $foregroundThread, $false) }
$result = $dialog.ShowDialog($owner)
$owner.Close()
$utf8 = New-Object System.Text.UTF8Encoding $false
function Escape-Json([string]$Value) {
  return $Value.Replace('\', '\\').Replace('"', '\"')
}
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  [System.IO.File]::WriteAllText($OutFile, '{"cancelled":true,"paths":[]}', $utf8)
  exit 0
}
$items = New-Object System.Collections.Generic.List[string]
foreach ($path in @($dialog.FileNames)) { $items.Add('"' + (Escape-Json $path) + '"') }
$json = '{"cancelled":false,"paths":[' + ($items -join ',') + ']}'
[System.IO.File]::WriteAllText($OutFile, $json, $utf8)
exit 0
