param(
    [Parameter(Mandatory)][string]$StageApp,
    [Parameter(Mandatory)][string]$Manifest
)
$ErrorActionPreference = 'Stop'
$stage = [IO.Path]::GetFullPath($StageApp)
$isolationRoot = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp\chatgpt_renderer_isolation_20261013'))
if (-not $stage.StartsWith(($isolationRoot + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Path $stage -Leaf) -notlike 'scope-probe-v*-app' -or
    $stage -match 'WindowsApps') {
    throw 'Integrity update is restricted to a staged app copy in Temp.'
}
$exe = Join-Path $stage 'ChatGPT.exe'
$asar = Join-Path $stage 'resources\app.asar'
$manifestData = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $asar) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $asar).Hash -ne $manifestData.output_sha256) {
    throw 'Staged ASAR identity mismatch.'
}
$active = @(Get-CimInstance Win32_Process -Filter "name='ChatGPT.exe'" |
    Where-Object { $_.ExecutablePath -eq $exe })
if ($active.Count -ne 0) { throw 'Do not update an executable while its staging instance is running.' }
if ($manifestData.header_sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid ASAR header hash.' }
$backup = "$exe.pre-bridge-integrity.bak"
if (Test-Path -LiteralPath $backup) { throw 'Backup already exists; refusing overwrite.' }
Copy-Item -LiteralPath $exe -Destination $backup -ErrorAction Stop
$resourceType = @"
using System;
using System.Runtime.InteropServices;
public static class BridgePeResourceUpdate {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool UpdateResource(IntPtr handle, string type, string name, ushort language, byte[] data, uint size);
 [DllImport("kernel32.dll", SetLastError=true)]
 public static extern bool EndUpdateResource(IntPtr handle, bool discard);
}
"@
Add-Type -TypeDefinition $resourceType -ErrorAction Stop
$data = '[{"file":"resources\\app.asar","alg":"SHA256","value":"' + $manifestData.header_sha256 + '"}]'
$bytes = [Text.Encoding]::UTF8.GetBytes($data)
$handle = [BridgePeResourceUpdate]::BeginUpdateResource($exe, $false)
if ($handle -eq [IntPtr]::Zero) { throw 'BeginUpdateResource failed.' }
$done = $false
try {
    if (-not [BridgePeResourceUpdate]::UpdateResource($handle, 'Integrity', 'ElectronAsar',
            [uint16]1033, $bytes, [uint32]$bytes.Length)) {
        throw 'UpdateResource failed.'
    }
    if (-not [BridgePeResourceUpdate]::EndUpdateResource($handle, $false)) {
        throw 'EndUpdateResource failed.'
    }
    $done = $true
} finally {
    if (-not $done) { [BridgePeResourceUpdate]::EndUpdateResource($handle, $true) | Out-Null }
}
[pscustomobject]@{
    StageExecutable = $exe
    ExecutableSHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash
    ASARSHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $asar).Hash
    HeaderSHA256 = $manifestData.header_sha256
    PublisherSignature = (Get-AuthenticodeSignature -FilePath $exe).Status.ToString()
}
