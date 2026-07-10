# Button+ MQTT Interaktiver Tester
# Finde das ECHTE Topic-Format durch Experimentieren

param(
    [string]$Test = "menu"
)

$broker = "crenserver"
$port = 1883
$user = "GIS"
$pass = "GIS2017!"
$device = "btn_9182a0"
$prefix = "buttonplus"

function Show-Menu {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Button+ MQTT Experimentier-Tool" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Device: $device" -ForegroundColor Yellow
    Write-Host "Firmware: V3.1.7" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "TESTS:" -ForegroundColor Green
    Write-Host "  1) Display Label testen (verschiedene Formate)"
    Write-Host "  2) Display Value testen"
    Write-Host "  3) Button Label testen"
    Write-Host "  4) MQTT Traffic LIVE überwachen"
    Write-Host "  5) Config vom Gerät holen"
    Write-Host "  q) Beenden"
    Write-Host ""
}

function Test-DisplayLabel {
    Write-Host "`n--- Display Label Test ---" -ForegroundColor Green

    $tests = @(
        @{ Name = "Standard Format"; Topic = "$prefix/$device/displayitem/0/label/set"; Payload = "TEST LABEL 1" }
        @{ Name = "Mit Page"; Topic = "$prefix/$device/displayitem/0-1/label/set"; Payload = "TEST LABEL 2" }
        @{ Name = "Ohne /set"; Topic = "$prefix/$device/displayitem/0/label"; Payload = "TEST LABEL 3" }
    )

    foreach ($test in $tests) {
        Write-Host "`nTeste: $($test.Name)" -ForegroundColor Yellow
        Write-Host "Topic:   $($test.Topic)" -ForegroundColor Gray
        Write-Host "Payload: $($test.Payload)" -ForegroundColor Gray

        mosquitto_pub -h $broker -p $port -u $user -P $pass `
            -t $test.Topic `
            -m $test.Payload `
            -r

        Write-Host "✓ Publiziert!" -ForegroundColor Green
        Write-Host ">> Siehst du '$($test.Payload)' am Display?" -ForegroundColor Cyan
        $response = Read-Host "   (j/n)"

        if ($response -eq "j") {
            Write-Host "==> ERFOLG! Dieses Format funktioniert!" -ForegroundColor Green
            Write-Host "    Topic: $($test.Topic)" -ForegroundColor Green
            return $test.Topic
        }
    }

    Write-Host "`n⚠️ Keiner der Tests hat funktioniert!" -ForegroundColor Red
}

function Test-DisplayValue {
    Write-Host "`n--- Display Value Test ---" -ForegroundColor Green

    $tests = @(
        @{ Name = "Standard Format"; Topic = "$prefix/$device/displayitem/0/value/set"; Payload = "999" }
        @{ Name = "Mit Page"; Topic = "$prefix/$device/displayitem/0-1/value/set"; Payload = "888" }
        @{ Name = "Als String"; Topic = "$prefix/$device/displayitem/0/value/set"; Payload = "TEST" }
    )

    foreach ($test in $tests) {
        Write-Host "`nTeste: $($test.Name)" -ForegroundColor Yellow
        Write-Host "Topic:   $($test.Topic)" -ForegroundColor Gray
        Write-Host "Payload: $($test.Payload)" -ForegroundColor Gray

        mosquitto_pub -h $broker -p $port -u $user -P $pass `
            -t $test.Topic `
            -m $test.Payload `
            -r

        Write-Host "✓ Publiziert!" -ForegroundColor Green
        Write-Host ">> Siehst du '$($test.Payload)' als GROSSEN WERT am Display?" -ForegroundColor Cyan
        $response = Read-Host "   (j/n)"

        if ($response -eq "j") {
            Write-Host "==> ERFOLG! Dieses Format funktioniert!" -ForegroundColor Green
            Write-Host "    Topic: $($test.Topic)" -ForegroundColor Green
            return $test.Topic
        }
    }
}

function Test-ButtonLabel {
    Write-Host "`n--- Button Label Test ---" -ForegroundColor Green
    Write-Host "Welchen Button willst du testen?" -ForegroundColor Yellow
    $buttonId = Read-Host "Button ID (z.B. 2)"
    $page = Read-Host "Seite (z.B. 1)"

    $tests = @(
        @{ Name = "Format: button/{id}/label/set"; Topic = "$prefix/$device/button/$buttonId/label/set"; Payload = "BTN-A" }
        @{ Name = "Format: button/{id}-{page}/label/set"; Topic = "$prefix/$device/button/$buttonId-$page/label/set"; Payload = "BTN-B" }
        @{ Name = "Format: button/{id}-{page}/toplabel/set"; Topic = "$prefix/$device/button/$buttonId-$page/toplabel/set"; Payload = "TOP-C" }
    )

    foreach ($test in $tests) {
        Write-Host "`nTeste: $($test.Name)" -ForegroundColor Yellow
        Write-Host "Topic:   $($test.Topic)" -ForegroundColor Gray
        Write-Host "Payload: $($test.Payload)" -ForegroundColor Gray

        mosquitto_pub -h $broker -p $port -u $user -P $pass `
            -t $test.Topic `
            -m $test.Payload `
            -r

        Write-Host "✓ Publiziert!" -ForegroundColor Green
        Write-Host ">> Siehst du '$($test.Payload)' am Button?" -ForegroundColor Cyan
        $response = Read-Host "   (j/n)"

        if ($response -eq "j") {
            Write-Host "==> ERFOLG!" -ForegroundColor Green
            return $test.Topic
        }
    }
}

function Watch-MqttTraffic {
    Write-Host "`n--- MQTT Traffic Live ---" -ForegroundColor Green
    Write-Host "Überwache: buttonplus/#" -ForegroundColor Yellow
    Write-Host "Drücke Buttons am Gerät um zu sehen welche Topics es sendet!" -ForegroundColor Cyan
    Write-Host "(Strg+C zum Beenden)" -ForegroundColor Gray
    Write-Host ""

    mosquitto_sub -h $broker -p $port -u $user -P $pass -t "buttonplus/#" -v
}

function Get-DeviceConfig {
    Write-Host "`n--- Device Config ---" -ForegroundColor Green
    $config = Invoke-RestMethod -Uri "http://192.168.178.33/config"
    $config | ConvertTo-Json -Depth 10 | Out-File "device-config-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    Write-Host "✓ Config gespeichert!" -ForegroundColor Green
}

# Main Loop
while ($true) {
    Show-Menu
    $choice = Read-Host "Wähle"

    switch ($choice) {
        "1" { Test-DisplayLabel }
        "2" { Test-DisplayValue }
        "3" { Test-ButtonLabel }
        "4" { Watch-MqttTraffic }
        "5" { Get-DeviceConfig }
        "q" { exit }
        default { Write-Host "Ungültige Wahl!" -ForegroundColor Red }
    }
}
