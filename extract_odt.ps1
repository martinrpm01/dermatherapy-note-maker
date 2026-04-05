Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = @(
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 1 site sim and Consult.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 1 site Tx note 1st fraction.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 1 Site Tx note w OTV + Physics.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 1 site Tx note.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 2 Site sim and Consult.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 2 site Tx note 1st fraction.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 2 site Tx note w OTV+Physics.odt',
    'C:\Users\cobra\Downloads\2026 EBRT Sim & Tx notes\2026 EBRT Sim & Tx notes\2026 2 site Tx note.odt'
)

foreach ($filePath in $files) {
    $fileName = [System.IO.Path]::GetFileName($filePath)
    Write-Output "=== FILE: $fileName ==="
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($filePath)
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'content.xml' }
        if ($entry) {
            $reader = New-Object System.IO.StreamReader($entry.Open())
            $xml = $reader.ReadToEnd()
            $reader.Close()
            # Strip XML tags - replace with space to preserve word boundaries
            $text = $xml -replace '<[^>]+>', ' '
            # Decode common XML entities
            $text = $text -replace '&amp;', '&'
            $text = $text -replace '&lt;', '<'
            $text = $text -replace '&gt;', '>'
            $text = $text -replace '&apos;', "'"
            $text = $text -replace '&quot;', '"'
            # Clean up excessive whitespace
            $text = $text -replace '\s+', ' '
            $text = $text.Trim()
            Write-Output $text
        } else {
            Write-Output 'content.xml not found in archive'
        }
        $zip.Dispose()
    } catch {
        Write-Output "ERROR: $($_.Exception.Message)"
    }
    Write-Output ''
    Write-Output '---END OF FILE---'
    Write-Output ''
}
