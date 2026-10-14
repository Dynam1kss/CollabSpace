# тримає машину без сну, поки живий цей процес. системних налаштувань
# живлення не чіпає: ES_CONTINUOUS живе на потоці й гасне разом із процесом
Add-Type -Name Pwr -Namespace KeepAwake -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED
$keep = [uint32]2147483649

while ($true) {
  [KeepAwake.Pwr]::SetThreadExecutionState($keep) | Out-Null
  Start-Sleep -Seconds 30
}
