# =============================================================================
#  MIGRADOR DROPBOX -> GOOGLE SHARED DRIVE  |  v5
#  Ejecutar: powershell -ExecutionPolicy Bypass -File .\Migrar-GUI.ps1
# =============================================================================
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Helper C# para capturar output de procesos sin script blocks en hilos ThreadPool.
# Los eventos OutputDataReceived/ErrorDataReceived de Process disparan en threads del pool;
# PowerShell no puede ejecutar script blocks ahi (PSInvalidOperation: GetContextFromTLS).
# Usar un handler C# nativo evita ese crash completamente.
Add-Type @"
using System;
using System.Text;
using System.Diagnostics;
public class ProcCapture {
    private StringBuilder _buf = new StringBuilder();
    public Process Start(string exe, string args) {
        var psi = new ProcessStartInfo(exe, args) {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        var p = new Process { StartInfo = psi };
        p.OutputDataReceived += (s,e) => { if(e.Data != null) lock(_buf) _buf.AppendLine(e.Data); };
        p.ErrorDataReceived  += (s,e) => { if(e.Data != null) lock(_buf) _buf.AppendLine(e.Data); };
        p.Start();
        p.StandardInput.Close();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        return p;
    }
    public string Output { get { lock(_buf) return _buf.ToString(); } }
}
"@ -Language CSharp

# ── Paleta ───────────────────────────────────────────────────────────────────
$C0 = [Drawing.Color]::FromArgb( 12,  12,  16)   # fondo profundo
$C1 = [Drawing.Color]::FromArgb( 20,  20,  26)   # paneles
$C2 = [Drawing.Color]::FromArgb( 30,  30,  40)   # controles
$C3 = [Drawing.Color]::FromArgb( 44,  44,  58)   # hover
$OR = [Drawing.Color]::FromArgb(255, 140,   0)   # naranja principal
$OD = [Drawing.Color]::FromArgb( 70,  36,   0)   # naranja oscuro fondo
$WT = [Drawing.Color]::FromArgb(220, 220, 228)   # texto
$MT = [Drawing.Color]::FromArgb(110, 110, 130)   # texto muted
$GR = [Drawing.Color]::FromArgb( 60, 190,  90)   # verde ok
$GD = [Drawing.Color]::FromArgb( 15,  50,  20)   # verde oscuro
$RD = [Drawing.Color]::FromArgb(220,  65,  65)   # rojo error
$RDK= [Drawing.Color]::FromArgb( 50,  12,  12)   # rojo oscuro
$AM = [Drawing.Color]::FromArgb(220, 175,  40)   # amber warn
$BDR= [Drawing.Color]::FromArgb( 50,  50,  65)   # borde

$FN  = New-Object Drawing.Font("Segoe UI",  9)
$FB  = New-Object Drawing.Font("Segoe UI",  9, [Drawing.FontStyle]::Bold)
$FS  = New-Object Drawing.Font("Segoe UI",  8)
$FM  = New-Object Drawing.Font("Consolas",  9)
$FH  = New-Object Drawing.Font("Segoe UI", 10, [Drawing.FontStyle]::Bold)
$FT  = New-Object Drawing.Font("Segoe UI", 12, [Drawing.FontStyle]::Bold)

# ── Estado global ─────────────────────────────────────────────────────────────
$G = @{
    RemoteDB  = "dropbox"; RemoteGD = "gdrive"
    CarpOrig  = ""; CarpDest = ""; DriveID = ""; DriveNom = ""
    DBNamespace = "private"   # "private" = Dropbox personal | "team_space" = espacio de equipo
    DBNamespaceId = ""        # root_namespace_id del equipo (se obtiene de la API de Dropbox)
    DBTeamName = ""           # nombre del equipo (ej: "AEROTOOLS UAV")
    Drives    = @()
    PilaDB    = [System.Collections.Generic.Stack[string]]::new()
    RutaDB    = ""
    PilaGD    = [System.Collections.Generic.Stack[string]]::new()
    RutaGD    = ""
    Proc = $null; RcPath = ""; LoadDBJob = $null; LoadGDJob = $null
    LogDir    = Join-Path (Join-Path $PSScriptRoot "logs") "$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    EnvFile   = Join-Path $PSScriptRoot "envMigracion.json"
}
if (-not (Test-Path $G.LogDir)) { New-Item -ItemType Directory -Path $G.LogDir | Out-Null }

# ── Helpers UI ────────────────────────────────────────────────────────────────
function L { param($t,$x,$y,$w=200,$h=20,$f=$FN,$c=$null)
    $l=New-Object Windows.Forms.Label; $l.Text=$t
    $l.Location=New-Object Drawing.Point($x,$y); $l.Size=New-Object Drawing.Size($w,$h)
    $l.Font=$f; $l.ForeColor=if($c){$c}else{$WT}; $l.BackColor=[Drawing.Color]::Transparent
    return $l }

function B { param($t,$x,$y,$w,$h=32,$bg=$null,$fg=$null)
    $b=New-Object Windows.Forms.Button; $b.Text=$t
    $b.Location=New-Object Drawing.Point($x,$y); $b.Size=New-Object Drawing.Size($w,$h)
    $b.FlatStyle="Flat"; $b.FlatAppearance.BorderSize=1
    $b.BackColor=if($bg){$bg}else{$C2}; $b.ForeColor=if($fg){$fg}else{$WT}
    $b.FlatAppearance.BorderColor=if($fg){$fg}else{$BDR}; $b.Font=$FN; return $b }

function T { param($x,$y,$w,$v="",$h=26)
    $t=New-Object Windows.Forms.TextBox
    $t.Location=New-Object Drawing.Point($x,$y); $t.Size=New-Object Drawing.Size($w,$h)
    $t.Text=$v; $t.Font=$FN; $t.BackColor=$C2; $t.ForeColor=$WT; $t.BorderStyle="FixedSingle"
    return $t }

function P { param($x,$y,$w,$h,$title="")
    $p=New-Object Windows.Forms.Panel
    $p.Location=New-Object Drawing.Point($x,$y); $p.Size=New-Object Drawing.Size($w,$h)
    $p.BackColor=$C1; $p.BorderStyle="None"
    if($title -ne ""){
        $r=New-Object Windows.Forms.Label; $r.Text=$title
        $r.Location=New-Object Drawing.Point(0,0); $r.Size=New-Object Drawing.Size($w,2)
        $r.BackColor=$OR; $p.Controls.Add($r)
        $lh=New-Object Windows.Forms.Label; $lh.Text=$title
        $lh.Location=New-Object Drawing.Point(14,10); $lh.Size=New-Object Drawing.Size(400,20)
        $lh.Font=$FH; $lh.ForeColor=$OR; $lh.BackColor=[Drawing.Color]::Transparent
        $p.Controls.Add($lh) }
    return $p }

function LB { param($x,$y,$w,$h)
    $l=New-Object Windows.Forms.ListBox; $l.Location=New-Object Drawing.Point($x,$y)
    $l.Size=New-Object Drawing.Size($w,$h); $l.Font=$FN
    $l.BackColor=$C2; $l.ForeColor=$WT; $l.BorderStyle="None"
    return $l }

function HR { param($parent,$y)
    $s=New-Object Windows.Forms.Label
    $s.Location=New-Object Drawing.Point(0,$y); $s.Size=New-Object Drawing.Size(2000,1)
    $s.BackColor=$BDR; $parent.Controls.Add($s) }

function SetSt { param($l,$t,$k="i")
    $l.Text=$t; $l.ForeColor=switch($k){"ok"{$GR}"err"{$RD}"warn"{$AM}default{$MT}} }

function LogLine { param($t,$c=$null)
    if(-not $rtbLog.IsHandleCreated){return}
    $rtbLog.Invoke([Action]{
        $col=if($c){$c}else{$WT}
        if($t -match "ERROR|error")      {$col=$RD}
        elseif($t -match "Transferred")  {$col=$GR}
        elseif($t -match "ETA|Checks:")  {$col=$OR}
        $rtbLog.SelectionStart=$rtbLog.TextLength; $rtbLog.SelectionLength=0
        $rtbLog.SelectionColor=$col; $rtbLog.AppendText("$t`n"); $rtbLog.ScrollToCaret() }) }

# ── rclone ────────────────────────────────────────────────────────────────────
function FindRC {
    $paths=@("rclone",(Join-Path $PSScriptRoot "rclone.exe"),
             (Join-Path $env:ProgramFiles "rclone\rclone.exe"),"C:\rclone\rclone.exe")
    $wp=Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if(Test-Path $wp){
        $f=Get-ChildItem $wp -Recurse -Filter "rclone.exe" -EA SilentlyContinue|Select-Object -First 1
        if($f){$paths+=$f.FullName}}
    foreach($r in $paths){
        try{$v=& $r version 2>&1|Select-Object -First 1
            if($v -match "rclone"){$G.RcPath=$r;return $true}}catch{}}
    return $false }

function RC { param([string[]]$a); & $G.RcPath @a }

function GetRemotes {
    try{return (RC @("listremotes"))|Where-Object{$_ -match '\S'}|ForEach-Object{$_.Trim().TrimEnd(":")}}
    catch{return @()} }

# Parsea la salida de "rclone lsd" extrayendo el nombre de carpeta (soporta espacios)
function ParseLsd { param($lines)
    return $lines |
        Where-Object{$_ -match '^\s*-?\d'} |
        ForEach-Object{ ($_ -split '\s+',6)[5] } |
        Where-Object{$_ -and $_ -ne ""} |
        Sort-Object }

# --- Obtiene root_namespace_id y nombre del team del usuario llamando a la API de Dropbox ---
# Dropbox Business separa: home_namespace_id (personal) y root_namespace_id (espacio del equipo).
# rclone usa home por defecto; para ver el espacio del equipo hace falta --dropbox-namespace-id <id>.
function GetDropboxTeamNs {
    try{
        # Forzar refresh del access_token haciendo una llamada minima con rclone
        & $G.RcPath lsd "$($G.RemoteDB):" --max-depth 1 *>$null
        # Leer el config para extraer el access_token fresco
        $cfg=& $G.RcPath config show $G.RemoteDB 2>&1 | Out-String
        if($cfg -notmatch 'token\s*=\s*(\{[^\r\n]+\})'){return $null}
        $tok=$matches[1] | ConvertFrom-Json
        $access=$tok.access_token
        if(-not $access){return $null}
        # Llamar a Dropbox API: /users/get_current_account (body literal "null")
        $r=Invoke-RestMethod `
            -Uri "https://api.dropboxapi.com/2/users/get_current_account" `
            -Method Post `
            -Headers @{Authorization="Bearer $access"} `
            -ContentType "application/json" `
            -Body "null"
        return @{
            Id   = [string]$r.root_info.root_namespace_id
            Name = if($r.team){[string]$r.team.name}else{""}
        }
    }catch{return $null} }

# --- Carga asincrona de carpetas Dropbox ---
# Para modo "team_space" se pasa --dropbox-root-namespace <id_numerico> a rclone.
# Ese id (root_namespace_id) se obtiene antes llamando a la API de Dropbox.
function LoadDB { param($ruta)
    $G.RutaDB=$ruta; $lblRuta.Text="  /"+$ruta
    $lstDB.Items.Clear(); $lstDB.Items.Add("Cargando...")|Out-Null
    if($G.LoadDBJob -and $G.LoadDBJob.State -eq "Running"){
        Stop-Job $G.LoadDBJob -EA SilentlyContinue
        Remove-Job $G.LoadDBJob -Force -EA SilentlyContinue }
    $rc=$G.RcPath; $remote=$G.RemoteDB; $ns=$G.DBNamespace; $nsId=$G.DBNamespaceId
    $job=Start-Job -ScriptBlock {
        param($rc,$remote,$ruta,$ns,$nsId)
        # IMPORTANTE: emitir cada item via Write-Output individual
        # (retornar arrays via `return` causa serializacion rara entre el job y el hilo UI)
        $rcArgs = @("lsd","$remote`:$ruta","--max-depth","1")
        if($ns -eq "team_space" -and $nsId){
            $rcArgs += @("--dropbox-root-namespace",$nsId)
        }
        $out = & $rc @rcArgs 2>&1
        $items = @()
        foreach($line in $out){
            $txt = [string]$line
            if($txt -match '^\s*-?\d'){
                $parts = $txt -split '\s+',6
                if($parts.Length -ge 6 -and $parts[5]){$items += $parts[5]}
            } elseif($txt -match 'ERROR|error|failed') {
                Write-Output "ERR:$txt"
                return
            }
        }
        foreach($i in ($items | Sort-Object)){ Write-Output $i }
    } -ArgumentList $rc,$remote,$ruta,$ns,$nsId
    $G.LoadDBJob=$job
    $st=@{job=$job; t=$null}
    $t=New-Object Windows.Forms.Timer; $t.Interval=500; $st.t=$t
    $t.add_Tick({
        if($st.job.State -notin @("Completed","Failed","Stopped")){return}
        $st.t.Stop()
        $out=@(Receive-Job $st.job -EA SilentlyContinue)
        Remove-Job $st.job -Force -EA SilentlyContinue
        $lstDB.Items.Clear()
        # Detectar error (primer elemento empieza por "ERR:")
        if($out.Count -gt 0 -and "$($out[0])".StartsWith("ERR:")){
            $lstDB.Items.Add("(error: $("$($out[0])".Substring(4)))")|Out-Null
            return
        }
        if($out.Count -eq 0){$lstDB.Items.Add("(sin subcarpetas)")|Out-Null}
        else{foreach($i in $out){$lstDB.Items.Add([string]$i)|Out-Null}}
    }.GetNewClosure())
    $t.Start() }

# --- Carga asincrona de carpetas Google Drive ---
function LoadGD { param($ruta)
    $G.RutaGD=$ruta; $lblRutaGD.Text="  /"+$ruta
    $lstGD.Items.Clear()
    if($G.DriveID -eq ""){$lstGD.Items.Add("(selecciona una unidad primero)")|Out-Null;return}
    $lstGD.Items.Add("Cargando...")|Out-Null
    if($G.LoadGDJob -and $G.LoadGDJob.State -eq "Running"){
        Stop-Job $G.LoadGDJob -EA SilentlyContinue
        Remove-Job $G.LoadGDJob -Force -EA SilentlyContinue }
    $rc=$G.RcPath; $remote=$G.RemoteGD; $did=$G.DriveID
    $job=Start-Job -ScriptBlock {
        param($rc,$remote,$ruta,$did)
        & $rc lsd "$remote`:$ruta" --drive-team-drive $did --max-depth 1 2>&1
    } -ArgumentList $rc,$remote,$ruta,$did
    $G.LoadGDJob=$job
    $st=@{job=$job; t=$null}
    $t=New-Object Windows.Forms.Timer; $t.Interval=500; $st.t=$t
    $t.add_Tick({
        if($st.job.State -notin @("Completed","Failed","Stopped")){return}
        $st.t.Stop()
        $out=@(Receive-Job $st.job -EA SilentlyContinue)
        Remove-Job $st.job -Force -EA SilentlyContinue
        $lstGD.Items.Clear()
        $items=ParseLsd $out
        if($items.Count -eq 0){$lstGD.Items.Add("(sin subcarpetas)")|Out-Null}
        else{foreach($i in $items){$lstGD.Items.Add($i)|Out-Null}}
    }.GetNewClosure())
    $t.Start() }

# --- Carga asincrona de unidades Drive ---
function LoadDrives {
    $lstUD.Items.Clear(); $lstUD.Items.Add("Cargando...")|Out-Null
    $G.Drives=@()
    $rc=$G.RcPath; $remote=$G.RemoteGD
    $job=Start-Job -ScriptBlock {
        param($rc,$remote)
        & $rc backend drives "$remote`:" 2>&1
    } -ArgumentList $rc,$remote
    $st=@{job=$job; t=$null}
    $t=New-Object Windows.Forms.Timer; $t.Interval=800; $st.t=$t
    $t.add_Tick({
        if($st.job.State -notin @("Completed","Failed","Stopped")){return}
        $st.t.Stop()
        $raw=(Receive-Job $st.job -EA SilentlyContinue) -join "`n"
        Remove-Job $st.job -Force -EA SilentlyContinue
        $lstUD.Items.Clear(); $G.Drives=@()
        $j=$raw.Trim()
        if($j -match "^\["){
            try{
                $parsed=$j|ConvertFrom-Json
                # Coleccion plana de drives (evita el bug de @() anidando arrays)
                $drs=[System.Collections.ArrayList]::new()
                foreach($d in $parsed){[void]$drs.Add($d)}
                if($drs.Count -gt 0){
                    $G.Drives=$drs
                    foreach($d in $drs){
                        $nm=[string]$d.name
                        if([string]::IsNullOrWhiteSpace($nm)){$nm="(sin nombre)"}
                        $lstUD.Items.Add($nm)|Out-Null
                    }
                    SetSt $lblDriveSt "$($drs.Count) unidades cargadas." "ok"
                } else {
                    $lstUD.Items.Add("(no hay Shared Drives)")|Out-Null
                    SetSt $lblDriveSt "Sin Shared Drives. Comprueba permisos." "warn" }
            }catch{
                $lstUD.Items.Add("(error de parseo)")|Out-Null
                SetSt $lblDriveSt "Error parseando JSON: $_" "err" }
        } else {
            $lstUD.Items.Add("(error al cargar)")|Out-Null
            SetSt $lblDriveSt "Error al cargar unidades." "err" }
    }.GetNewClosure())
    $t.Start() }

function SaveEnv {
    @{RemoteDB=$G.RemoteDB;RemoteGD=$G.RemoteGD}|ConvertTo-Json|
        Set-Content -Path $G.EnvFile -Encoding UTF8 }

function LoadEnv {
    if(Test-Path $G.EnvFile){
        try{
            $e=Get-Content $G.EnvFile -Raw|ConvertFrom-Json
            if($e.RemoteDB){$G.RemoteDB=$e.RemoteDB;$txtNDB.Text=$e.RemoteDB}
            if($e.RemoteGD){$G.RemoteGD=$e.RemoteGD;$txtNGD.Text=$e.RemoteGD}
            return $true}catch{}}
    return $false }

function CheckReady { $btnGo.Enabled = ($G.DriveID -ne "" -and $null -ne $G.CarpOrig -and $null -ne $G.CarpDest) }

# =============================================================================
# VENTANA
# =============================================================================
$form=New-Object Windows.Forms.Form
$form.Text="Migrador Dropbox -> Google Shared Drive"
$form.Size=New-Object Drawing.Size(1300,1060)
$form.MinimumSize=New-Object Drawing.Size(1200,960)
$form.BackColor=$C0; $form.ForeColor=$WT; $form.Font=$FN
$form.StartPosition="CenterScreen"

# ── Barra nav ─────────────────────────────────────────────────────────────────
$nav=New-Object Windows.Forms.Panel
$nav.Location=New-Object Drawing.Point(0,0); $nav.Size=New-Object Drawing.Size(940,50)
$nav.BackColor=[Drawing.Color]::FromArgb(10,10,14)
$form.Controls.Add($nav)

# Titulo app en nav
$appTitle=L "  MIGRADOR DROPBOX > DRIVE" 10 14 280 22 $FT $OR
$nav.Controls.Add($appTitle)

# Botones nav
$navBtns=@()
$navLabels=@("Requisitos","Cuentas","Migrar")
for($i=0;$i -lt 3;$i++){
    $nb=New-Object Windows.Forms.Button
    $nb.Text=$navLabels[$i]; $nb.Size=New-Object Drawing.Size(110,50)
    $nb.Location=New-Object Drawing.Point((300 + $i*115),0)
    $nb.FlatStyle="Flat"; $nb.FlatAppearance.BorderSize=0
    $nb.BackColor=[Drawing.Color]::FromArgb(10,10,14)
    $nb.ForeColor=$MT; $nb.Font=$FB
    $nav.Controls.Add($nb); $navBtns+=$nb }

$navLine=New-Object Windows.Forms.Label
$navLine.Size=New-Object Drawing.Size(110,3)
$navLine.Location=New-Object Drawing.Point(300,47)
$navLine.BackColor=$OR; $nav.Controls.Add($navLine)

# Contenedor paginas
$wrap=New-Object Windows.Forms.Panel
$wrap.Location=New-Object Drawing.Point(0,50); $wrap.Size=New-Object Drawing.Size(940,710)
$wrap.BackColor=$C0; $form.Controls.Add($wrap)

$pg=@()
for($i=0;$i -lt 3;$i++){
    $pp=New-Object Windows.Forms.Panel; $pp.Dock="Fill"
    $pp.BackColor=$C0; $pp.Visible=($i -eq 0)
    $wrap.Controls.Add($pp); $pg+=$pp }

function GoPage { param($idx)
    for($i=0;$i -lt 3;$i++){$pg[$i].Visible=($i -eq $idx)}
    $navLine.Left=300+$idx*115
    for($i=0;$i -lt 3;$i++){
        $navBtns[$i].ForeColor=if($i -eq $idx){$OR}else{$MT}
        $navBtns[$i].BackColor=if($i -eq $idx){[Drawing.Color]::FromArgb(20,12,0)}else{[Drawing.Color]::FromArgb(10,10,14)} }
    if($idx -eq 2){
        # Auto-cargar carpetas de Dropbox al entrar en Migrar
        if($lstDB.Items.Count -eq 0 -and $G.RcPath -ne "" -and $G.RemoteDB -ne ""){
            $G.RemoteDB=$txtNDB.Text.Trim(); LoadDB "" }
        # Auto-cargar unidades de Drive si aun no se han cargado
        if($lstUD.Items.Count -eq 0 -and $G.DriveID -eq "" -and $G.RcPath -ne "" -and $G.RemoteGD -ne ""){
            $G.RemoteGD=$txtNGD.Text.Trim(); LoadDrives }
    }}

$navBtns[0].add_Click({GoPage 0})
$navBtns[1].add_Click({GoPage 1})
$navBtns[2].add_Click({GoPage 2})

# =============================================================================
# PG 0 - REQUISITOS
# =============================================================================
$r0=P 20 20 880 480 "Requisitos"
$pg[0].Controls.Add($r0)

$r0.Controls.Add((L "Este programa necesita rclone instalado para funcionar." 14 38 700 20 $FN $WT))
$r0.Controls.Add((L "Si no lo tienes, pulsa el boton de abajo y se instala automaticamente." 14 58 700 18 $FS $MT))

HR $r0 82

$r0.Controls.Add((L "rclone" 14 96 80 20 $FB $OR))
$r0.Controls.Add((L "Motor de transferencia en la nube - necesario para todo" 100 98 520 18 $FS $MT))
$btnInstRC=B "Instalar rclone" 730 92 135 28 $OD $OR; $r0.Controls.Add($btnInstRC)
$lblRC=L "Comprobando..." 14 122 850 18 $FS $MT; $r0.Controls.Add($lblRC)

HR $r0 146

$r0.Controls.Add((L "Metodos de instalacion:" 14 158 300 18 $FB $WT))

$rtbInfo=New-Object Windows.Forms.RichTextBox
$rtbInfo.Location=New-Object Drawing.Point(14,182); $rtbInfo.Size=New-Object Drawing.Size(852,110)
$rtbInfo.Font=$FM; $rtbInfo.ReadOnly=$true
$rtbInfo.BackColor=[Drawing.Color]::FromArgb(8,8,12); $rtbInfo.ForeColor=$MT
$rtbInfo.BorderStyle="None"
$rtbInfo.Text="Metodo 1 - winget (automatico):`r`n  winget install Rclone.Rclone`r`n`r`nMetodo 2 - descarga directa (automatico si winget falla):`r`n  Descarga rclone.exe de rclone.org y lo copia junto a este script`r`n`r`nMetodo 3 - manual: descarga el ZIP de rclone.org/downloads y pon rclone.exe en la carpeta del script"
$r0.Controls.Add($rtbInfo)

$progRC=New-Object Windows.Forms.ProgressBar
$progRC.Location=New-Object Drawing.Point(14,302); $progRC.Size=New-Object Drawing.Size(852,8)
$progRC.Style="Marquee"; $progRC.MarqueeAnimationSpeed=0; $r0.Controls.Add($progRC)

$lblInstMsg=L "" 14 316 852 18 $FS $MT; $r0.Controls.Add($lblInstMsg)

HR $r0 340

$btnCheckRC=B "Comprobar instalacion" 14 358 195 32 $C2 $OR; $r0.Controls.Add($btnCheckRC)
$lblCheckMsg=L "" 220 364 640 20 $FS $MT; $r0.Controls.Add($lblCheckMsg)

$btnGoP1=B "Continuar -> Configurar cuentas" 14 404 265 36 $OD $OR
$btnGoP1.Font=$FB; $btnGoP1.Enabled=$false; $pg[0].Controls.Add($btnGoP1)

# =============================================================================
# PG 1 - CUENTAS
# =============================================================================

# Card Dropbox
$c1db=P 20 20 880 185 "Dropbox"
$pg[1].Controls.Add($c1db)

$c1db.Controls.Add((L "Nombre del remote:" 14 38 150 20))
$txtNDB=T 168 35 140 "dropbox"; $c1db.Controls.Add($txtNDB)
$c1db.Controls.Add((L "(sin espacios, como quieras llamarlo)" 320 38 320 18 $FS $MT))

$c1db.Controls.Add((L "Pulsa el boton para abrir el navegador. Inicia sesion en Dropbox y acepta." 14 68 720 18 $FS $MT))
$c1db.Controls.Add((L "El token se guardara automaticamente sin que tengas que copiar nada." 14 86 720 18 $FS $MT))

$progDB=New-Object Windows.Forms.ProgressBar
$progDB.Location=New-Object Drawing.Point(14,112); $progDB.Size=New-Object Drawing.Size(852,6)
$progDB.Style="Marquee"; $progDB.MarqueeAnimationSpeed=0; $c1db.Controls.Add($progDB)

$btnCDB=B "Conectar Dropbox" 14 124 190 36 $OD $OR; $btnCDB.Font=$FB; $c1db.Controls.Add($btnCDB)
$lblSDB=L "Sin conectar" 216 132 640 20 $FS $MT; $c1db.Controls.Add($lblSDB)

# Card Google Drive
$c1gd=P 20 215 880 200 "Google Drive"
$pg[1].Controls.Add($c1gd)

$c1gd.Controls.Add((L "Nombre del remote:" 14 38 150 20))
$txtNGD=T 168 35 140 "gdrive"; $c1gd.Controls.Add($txtNGD)
$c1gd.Controls.Add((L "(sin espacios, como quieras llamarlo)" 320 38 320 18 $FS $MT))

$c1gd.Controls.Add((L "Pulsa el boton para abrir el navegador. Inicia sesion con tu cuenta de Google." 14 68 720 18 $FS $MT))
$c1gd.Controls.Add((L "Usa la cuenta que tenga acceso a las Shared Drives de tu empresa." 14 86 720 18 $FS $AM))
$c1gd.Controls.Add((L "El token se guardara automaticamente sin que tengas que copiar nada." 14 104 720 18 $FS $MT))

$progGD=New-Object Windows.Forms.ProgressBar
$progGD.Location=New-Object Drawing.Point(14,128); $progGD.Size=New-Object Drawing.Size(852,6)
$progGD.Style="Marquee"; $progGD.MarqueeAnimationSpeed=0; $c1gd.Controls.Add($progGD)

$btnCGD=B "Conectar Google Drive" 14 140 210 36 $OD $OR; $btnCGD.Font=$FB; $c1gd.Controls.Add($btnCGD)
$lblSGD=L "Sin conectar" 236 148 640 20 $FS $MT; $c1gd.Controls.Add($lblSGD)

# Card verificar
$c1ver=P 20 425 880 58 ""
$pg[1].Controls.Add($c1ver)
$btnVer=B "Verificar conexiones" 14 13 195 32 $C2 $OR; $c1ver.Controls.Add($btnVer)
$lblVer=L "Pulsa para comprobar que Dropbox y Drive estan conectados." 224 19 640 20 $FS $MT
$c1ver.Controls.Add($lblVer)

$btnGoP2=B "Cuentas listas -> Ir a Migrar" 20 494 260 36 $OD $OR
$btnGoP2.Font=$FB; $btnGoP2.Enabled=$false; $pg[1].Controls.Add($btnGoP2)

# =============================================================================
# PG 2 - MIGRAR
# =============================================================================
# Constantes de layout — se recalculan al redimensionar via $form.add_Resize
$p2W=1268   # ancho util inicial
$pnW=620    # ancho inicial de cada panel
$pnH=575    # alto paneles

# ── Panel Origen (Dropbox) ────────────────────────────────────────────────────
$c2orig=P 15 15 $pnW $pnH "Origen (Dropbox)"
$pg[2].Controls.Add($c2orig)

# Toggle namespace (arriba)
$btnDBPersonal =B "Personal" 14 38 110 24 $OR $C0; $btnDBPersonal.Font=$FB
$btnDBEquipo   =B "Equipo"   130 38 180 24 $C2 $MT; $btnDBEquipo.Font=$FB
$c2orig.Controls.Add($btnDBPersonal); $c2orig.Controls.Add($btnDBEquipo)

$lblRuta=L "  /" 14 70 592 16 $FS $MT; $c2orig.Controls.Add($lblRuta)
$lstDB=LB 14 90 592 412; $c2orig.Controls.Add($lstDB)

$btnUp  =B "^ Subir"           14 510 100 32 $C2 $MT
$btnIn  =B "Entrar >"          120 510 100 32 $C3 $OR
$btnSel =B "Usar esta carpeta" 226 510 230 32 $OD $OR; $btnSel.Font=$FB
$btnRefDB=B "Recargar"         462 510 144 32 $C2 $MT
$c2orig.Controls.Add($btnUp); $c2orig.Controls.Add($btnIn); $c2orig.Controls.Add($btnSel); $c2orig.Controls.Add($btnRefDB)

$lblOrigSel=L "Raiz de Dropbox seleccionada" 14 548 592 18 $FS $MT; $c2orig.Controls.Add($lblOrigSel)

# ── Panel Destino (Google Drive) ──────────────────────────────────────────────
$c2dest=P 651 15 $pnW $pnH "Destino (Shared Drive)"
$pg[2].Controls.Add($c2dest)

# -- Selector de unidad compartida
$c2dest.Controls.Add((L "Unidad compartida:" 14 38 200 18 $FB $WT))
$lstUD=LB 14 58 592 72; $c2dest.Controls.Add($lstUD)
$btnLoadUD=B "Cargar unidades" 14 136 180 28 $OD $OR; $c2dest.Controls.Add($btnLoadUD)
$lblDriveSt=L "Pulsa para cargar." 204 142 400 18 $FS $MT; $c2dest.Controls.Add($lblDriveSt)

# -- Separador visual
$sep=New-Object Windows.Forms.Label
$sep.Location=New-Object Drawing.Point(14,172); $sep.Size=New-Object Drawing.Size(592,1)
$sep.BackColor=$BDR; $c2dest.Controls.Add($sep)

# -- Navegador de carpetas dentro de la unidad
$c2dest.Controls.Add((L "Carpeta destino dentro de la unidad:" 14 180 400 16 $FB $WT))
$lblRutaGD=L "  /" 14 200 592 16 $FS $MT; $c2dest.Controls.Add($lblRutaGD)
$lstGD=LB 14 220 592 282; $c2dest.Controls.Add($lstGD)

$btnGDUp  =B "^ Subir"        14 510 100 32 $C2 $MT
$btnGDIn  =B "Entrar >"       120 510 100 32 $C3 $OR
$btnGDSel =B "Destino aqui"   226 510 230 32 $OD $OR; $btnGDSel.Font=$FB
$btnGDRoot=B "Raiz de unidad" 462 510 144 32 $C2 $OR
$c2dest.Controls.Add($btnGDUp); $c2dest.Controls.Add($btnGDIn); $c2dest.Controls.Add($btnGDSel); $c2dest.Controls.Add($btnGDRoot)

$lblDestSel=L "Sin seleccionar" 14 548 592 18 $FS $MT; $c2dest.Controls.Add($lblDestSel)

# ── Opciones ──────────────────────────────────────────────────────────────────
$c2opc=P 15 600 $p2W 76 ""
$pg[2].Controls.Add($c2opc)

$chkSim=New-Object Windows.Forms.CheckBox
$chkSim.Text="Simulacion (dry-run)  --  no mueve nada, solo muestra lo que haria"
$chkSim.Location=New-Object Drawing.Point(14,10); $chkSim.Size=New-Object Drawing.Size(520,22)
$chkSim.Checked=$true; $chkSim.ForeColor=$AM; $chkSim.Font=$FN
$chkSim.BackColor=[Drawing.Color]::Transparent; $c2opc.Controls.Add($chkSim)

$chkWrap=New-Object Windows.Forms.CheckBox
$chkWrap.Text="Crear subcarpeta con el nombre del origen en el destino"
$chkWrap.Location=New-Object Drawing.Point(14,34); $chkWrap.Size=New-Object Drawing.Size(520,22)
$chkWrap.Checked=$true; $chkWrap.ForeColor=$WT; $chkWrap.Font=$FN
$chkWrap.BackColor=[Drawing.Color]::Transparent; $c2opc.Controls.Add($chkWrap)

$c2opc.Controls.Add((L "Banda:" 560 12 52 20))
$txtBanda=T 614 9 80 "0"; $c2opc.Controls.Add($txtBanda)
$c2opc.Controls.Add((L "0=libre  ej:50M" 700 12 120 18 $FS $MT))
$c2opc.Controls.Add((L "Transferencias:" 560 40 115 20))
$numT=New-Object Windows.Forms.NumericUpDown
$numT.Location=New-Object Drawing.Point(680,37); $numT.Size=New-Object Drawing.Size(62,22)
$numT.Minimum=1; $numT.Maximum=64; $numT.Value=32
$numT.BackColor=$C2; $numT.ForeColor=$WT; $numT.BorderStyle="FixedSingle"
$c2opc.Controls.Add($numT)
$c2opc.Controls.Add((L "Recomendado 32-48 (turbo)" 752 40 240 18 $FS $MT))

# ── Barra accion ──────────────────────────────────────────────────────────────
$barAct=New-Object Windows.Forms.Panel
$barAct.Location=New-Object Drawing.Point(15,684); $barAct.Size=New-Object Drawing.Size($p2W,46)
$barAct.BackColor=$C0; $pg[2].Controls.Add($barAct)

$btnGo=B "INICIAR MIGRACION" 0 6 210 34 $OD $OR; $btnGo.Font=$FB
$btnGo.FlatAppearance.BorderColor=$OR; $btnGo.Enabled=$false; $barAct.Controls.Add($btnGo)
$btnStop=B "DETENER" 220 6 120 34 $RDK $RD; $btnStop.Font=$FB
$btnStop.Enabled=$false; $barAct.Controls.Add($btnStop)
$btnLogs=B "Ver logs" 352 6 110 34 $C2 $MT; $barAct.Controls.Add($btnLogs)
$lblMigSt=L "" 476 13 780 20 $FS $MT; $barAct.Controls.Add($lblMigSt)

# ── Stats ─────────────────────────────────────────────────────────────────────
$c2st=P 15 738 $p2W 64 ""
$pg[2].Controls.Add($c2st)
$stW2=[int](($p2W-20)/5)
$stCards=@(
    @{x=0;       titulo="Archivos movidos"},
    @{x=$stW2;   titulo="Velocidad"},
    @{x=$stW2*2; titulo="ETA"},
    @{x=$stW2*3; titulo="Progreso"},
    @{x=$stW2*4; titulo="Errores"}
)
$stLabels=@()
foreach($sc in $stCards){
    $card=New-Object Windows.Forms.Panel
    $card.Location=New-Object Drawing.Point(($sc.x+10), 8)
    $card.Size=New-Object Drawing.Size(($stW2-10), 48)
    $card.BackColor=$C2; $card.BorderStyle="None"
    $lt=New-Object Windows.Forms.Label; $lt.Text=$sc.titulo
    $lt.Location=New-Object Drawing.Point(10,4); $lt.Size=New-Object Drawing.Size(($stW2-22),14)
    $lt.Font=$FS; $lt.ForeColor=$MT; $lt.BackColor=[Drawing.Color]::Transparent
    $lv=New-Object Windows.Forms.Label; $lv.Text="-"
    $lv.Location=New-Object Drawing.Point(10,18); $lv.Size=New-Object Drawing.Size(($stW2-22),26)
    $lv.Font=$FH; $lv.ForeColor=$WT; $lv.BackColor=[Drawing.Color]::Transparent
    $card.Controls.Add($lt); $card.Controls.Add($lv)
    $c2st.Controls.Add($card); $stLabels+=$lv }
$stLabels[4].ForeColor=$GR

# ── Progress + Log ────────────────────────────────────────────────────────────
$progMig=New-Object Windows.Forms.ProgressBar
$progMig.Location=New-Object Drawing.Point(15,810); $progMig.Size=New-Object Drawing.Size($p2W,8)
$progMig.Style="Marquee"; $progMig.MarqueeAnimationSpeed=0; $pg[2].Controls.Add($progMig)

$pg[2].Controls.Add((L "Log:" 15 824 50 16 $FB $OR))
$rtbLog=New-Object Windows.Forms.RichTextBox
$rtbLog.Location=New-Object Drawing.Point(15,842); $rtbLog.Size=New-Object Drawing.Size($p2W,140)
$rtbLog.Font=$FM; $rtbLog.BackColor=[Drawing.Color]::FromArgb(8,8,12)
$rtbLog.ForeColor=$WT; $rtbLog.ReadOnly=$true; $rtbLog.BorderStyle="None"
$rtbLog.ScrollBars="Vertical"; $pg[2].Controls.Add($rtbLog)

# =============================================================================
# EVENTOS PG 0
# =============================================================================
function ChkRC {
    if(FindRC){
        $v=& $G.RcPath version 2>&1|Select-Object -First 1
        SetSt $lblRC "[OK] $v" "ok"; $btnInstRC.Enabled=$false; return $true}
    SetSt $lblRC "No encontrado. Pulsa Instalar." "warn"; $btnInstRC.Enabled=$true; return $false }

$btnInstRC.add_Click({
    $btnInstRC.Enabled=$false; $progRC.MarqueeAnimationSpeed=25
    SetSt $lblInstMsg "Instalando..." "warn"
    $sd=$PSScriptRoot
    $job=Start-Job -ScriptBlock{
        param($d)
        try{$wg=& winget --version 2>&1
            if($wg -match '\d'){
                & winget install Rclone.Rclone --silent --accept-package-agreements --accept-source-agreements 2>&1
                return "winget"}}catch{}
        try{$z=Join-Path $env:TEMP "rc.zip"; $ex=Join-Path $env:TEMP "rcex"
            Invoke-WebRequest "https://downloads.rclone.org/rclone-current-windows-amd64.zip" -OutFile $z -UseBasicParsing
            Expand-Archive $z $ex -Force
            $e=Get-ChildItem $ex -Recurse -Filter "rclone.exe"|Select-Object -First 1
            if($e){Copy-Item $e.FullName (Join-Path $d "rclone.exe") -Force;return "dl"}}catch{}
        return "err"} -ArgumentList $sd
    $ti=New-Object Windows.Forms.Timer; $ti.Interval=1500
    $ti.add_Tick({
        if($job.State -in "Completed","Failed"){
            $ti.Stop(); $progRC.MarqueeAnimationSpeed=0
            $r=if($job.State -eq "Completed"){Receive-Job $job}else{"err"}
            Remove-Job $job -Force
            if(ChkRC){SetSt $lblInstMsg "Instalado ($r)." "ok"; $btnCheckRC.PerformClick()}
            else{SetSt $lblInstMsg "Fallo. Descarga rclone.exe manualmente de rclone.org y ponlo aqui." "err"; $btnInstRC.Enabled=$true}}
        else{SetSt $lblInstMsg "Instalando... puede tardar un momento." "warn"}})
    $ti.Start()})

$btnCheckRC.add_Click({
    if(ChkRC){SetSt $lblCheckMsg "Todo listo. Puedes continuar." "ok"; $btnGoP1.Enabled=$true}
    else{SetSt $lblCheckMsg "Falta rclone." "err"; $btnGoP1.Enabled=$false}})

$btnGoP1.add_Click({GoPage 1})

# =============================================================================
# EVENTOS PG 1  -  OAuth totalmente automatico
# =============================================================================
function StartOAuth { param($backend,$nTxt,$prog,$lbl,$onOK)
    if(-not (FindRC)){[Windows.Forms.MessageBox]::Show("Instala rclone primero.")|Out-Null;return}
    Get-Process -Name "rclone" -EA SilentlyContinue |
        Where-Object {$_.MainWindowHandle -eq [IntPtr]::Zero} |
        Stop-Process -Force -EA SilentlyContinue
    $nombre=$nTxt.Text.Trim(); if($nombre -eq ""){$nombre=$backend;$nTxt.Text=$nombre}
    $prog.MarqueeAnimationSpeed=25
    SetSt $lbl "Abriendo el navegador... inicia sesion y acepta los permisos." "warn"

    # ProcCapture usa handlers C# nativos (no script blocks de PS) para capturar
    # stdout/stderr en hilos ThreadPool sin crash de GetContextFromTLS.
    # Tambien cierra stdin de inmediato para que rclone no espere un Enter al final.
    $cap=New-Object ProcCapture
    $ap=$cap.Start($G.RcPath, "authorize $backend")

    # Empaquetar todo en un hashtable de estado: .GetNewClosure() captura variables
    # por valor (snapshot), pero un hashtable es por referencia y se puede mutar
    # entre ticks. Sin esto, $ap/$cap son $null en el handler y HasExited=$null ->
    # -not $null = $true -> el tick siempre retorna sin hacer nada.
    $st=@{ ap=$ap; cap=$cap; at=$null; prog=$prog; lbl=$lbl; nombre=$nombre
           backend=$backend; onOK=$onOK; ticks=0 }

    $at=New-Object Windows.Forms.Timer; $at.Interval=1000
    $st.at=$at
    $at.add_Tick({
        $st.ticks++
        # Timeout de seguridad: 10 minutos
        if($st.ticks -gt 600){
            $st.at.Stop(); $st.prog.MarqueeAnimationSpeed=0
            SetSt $st.lbl "Tiempo de espera agotado. Vuelve a intentarlo." "err"
            try{if(-not $st.ap.HasExited){$st.ap.Kill()}}catch{}
            return
        }
        try{
            if(-not $st.ap.HasExited){return}
            $st.at.Stop(); $st.prog.MarqueeAnimationSpeed=0
            $st.ap.WaitForExit(3000)|Out-Null   # flush final de los readers async
            $out=$st.cap.Output
            try{$st.ap.Dispose()}catch{}
            $tok=""
            if($out -match '(?s)(\{"access_token".+?"expiry"\s*:\s*"[^"]+"\})'){$tok=$matches[1]}
            elseif($out -match '(?s)(\{[^{}]*"access_token"[^{}]*\})'){$tok=$matches[1]}
            if($tok -ne ""){
                & $G.RcPath config create $st.nombre $st.backend token $tok 2>&1|Out-Null
                SetSt $st.lbl "[OK] Conectado y guardado automaticamente." "ok"
                & $st.onOK $st.nombre
                try{SaveEnv}catch{}
            }
            $rn=GetRemotes
            if($rn -contains $st.nombre){
                & $st.onOK $st.nombre
                if($tok -eq ""){SetSt $st.lbl "[OK] Conectado." "ok"}
                try{SaveEnv}catch{}
                if(($rn -contains $G.RemoteDB) -and ($rn -contains $G.RemoteGD)){
                    SetSt $lblVer "OK - Ambos remotes conectados. Puedes migrar." "ok"
                    $btnGoP2.Enabled=$true}
            } elseif($tok -eq ""){
                SetSt $st.lbl "No se pudo guardar el token. Vuelve a intentarlo." "err"
            }
        }catch{
            try{$st.at.Stop()}catch{}
            $st.prog.MarqueeAnimationSpeed=0
            SetSt $st.lbl "Error inesperado: $_" "err"
            try{$st.ap.Dispose()}catch{}
        }}.GetNewClosure())
    $at.Start()}

$btnCDB.add_Click({ StartOAuth "dropbox" $txtNDB $progDB $lblSDB {param($n);$G.RemoteDB=$n} })
$btnCGD.add_Click({ StartOAuth "drive"   $txtNGD $progGD $lblSGD {param($n);$G.RemoteGD=$n} })

$btnVer.add_Click({
    $G.RemoteDB=$txtNDB.Text.Trim(); $G.RemoteGD=$txtNGD.Text.Trim()
    if(-not (FindRC)){SetSt $lblVer "rclone no encontrado." "err";return}
    $r=GetRemotes; $db=$r -contains $G.RemoteDB; $gd=$r -contains $G.RemoteGD
    if($db -and $gd){
        SetSt $lblVer "OK - Ambos conectados." "ok"; $btnGoP2.Enabled=$true
        SetSt $lblSDB "[OK] Conectado" "ok"; SetSt $lblSGD "[OK] Conectado" "ok"; SaveEnv}
    elseif(-not $db -and -not $gd){SetSt $lblVer "Ninguno conectado aun." "err"}
    elseif(-not $db){SetSt $lblVer "Dropbox no encontrado. Pulsa Conectar Dropbox." "err"}
    else{SetSt $lblVer "Drive no encontrado. Pulsa Conectar Google Drive." "err"}})

$btnGoP2.add_Click({GoPage 2})

# =============================================================================
# EVENTOS PG 2
# =============================================================================

# ── Dropbox ───────────────────────────────────────────────────────────────────
function SetDBActive { param($ns)
    if($ns -eq "team_space"){
        $btnDBEquipo.BackColor=$OR;   $btnDBEquipo.ForeColor=$C0
        $btnDBPersonal.BackColor=$C2; $btnDBPersonal.ForeColor=$MT
    } else {
        $btnDBPersonal.BackColor=$OR; $btnDBPersonal.ForeColor=$C0
        $btnDBEquipo.BackColor=$C2;   $btnDBEquipo.ForeColor=$MT } }

$btnDBPersonal.add_Click({
    $G.DBNamespace="private"; $G.PilaDB.Clear()
    SetDBActive "private"
    $G.RemoteDB=$txtNDB.Text.Trim(); LoadDB "" })

$btnDBEquipo.add_Click({
    $G.RemoteDB=$txtNDB.Text.Trim()
    # Si aun no tenemos el namespace id del equipo, lo pedimos a la API de Dropbox
    if(-not $G.DBNamespaceId){
        $lstDB.Items.Clear(); $lstDB.Items.Add("Obteniendo info del equipo...")|Out-Null
        $form.Cursor=[Windows.Forms.Cursors]::WaitCursor
        try{
            $info=GetDropboxTeamNs
            if(-not $info -or -not $info.Id){
                $lstDB.Items.Clear()
                $lstDB.Items.Add("(no se pudo obtener el namespace del equipo)")|Out-Null
                [Windows.Forms.MessageBox]::Show(
                    "No se pudo obtener el namespace del equipo de Dropbox.`r`n`r`nPosibles causas:`r`n  - La cuenta no es de Dropbox Business`r`n  - El token ha caducado (vuelve a conectar Dropbox)`r`n  - Sin conexion a internet",
                    "Error","OK","Warning")|Out-Null
                return
            }
            $G.DBNamespaceId=$info.Id; $G.DBTeamName=$info.Name
            if($G.DBTeamName){$btnDBEquipo.Text=$G.DBTeamName}
        }finally{$form.Cursor=[Windows.Forms.Cursors]::Default}
    }
    $G.DBNamespace="team_space"; $G.PilaDB.Clear()
    SetDBActive "team_space"
    LoadDB "" })

$btnRefDB.add_Click({$G.RemoteDB=$txtNDB.Text.Trim(); LoadDB ""})
$btnIn.add_Click({
    if($lstDB.SelectedItem -and $lstDB.SelectedItem -notin @("(sin subcarpetas)","Cargando...")){
        $G.PilaDB.Push($G.RutaDB)
        $n=if($G.RutaDB -eq ""){$lstDB.SelectedItem}else{"$($G.RutaDB)/$($lstDB.SelectedItem)"}
        LoadDB $n}})
$lstDB.add_DoubleClick({$btnIn.PerformClick()})
$btnUp.add_Click({if($G.PilaDB.Count -gt 0){LoadDB($G.PilaDB.Pop())}else{LoadDB ""}})
$btnSel.add_Click({
    $G.CarpOrig=$G.RutaDB
    $d=if($G.RutaDB -eq ""){"/"}else{"/$($G.RutaDB)"}
    SetSt $lblOrigSel "[OK] $d" "ok"; CheckReady})

# ── Shared Drive — selector de unidad ────────────────────────────────────────
$btnLoadUD.add_Click({$G.RemoteGD=$txtNGD.Text.Trim(); LoadDrives})

$lstUD.add_SelectedIndexChanged({
    $i=$lstUD.SelectedIndex
    if($i -ge 0 -and $G.Drives.Count -gt $i){
        $d=$G.Drives[$i]; $G.DriveID=$d.id; $G.DriveNom=$d.name
        SetSt $lblDriveSt "[OK] $($d.name)" "ok"
        # Cargar raiz de la unidad seleccionada
        $G.PilaGD.Clear(); LoadGD ""}})

# ── Shared Drive — navegador de carpetas ─────────────────────────────────────
$btnGDIn.add_Click({
    if($lstGD.SelectedItem -and $lstGD.SelectedItem -notin @("(sin subcarpetas)","(selecciona una unidad primero)","Cargando...")){
        $G.PilaGD.Push($G.RutaGD)
        $n=if($G.RutaGD -eq ""){$lstGD.SelectedItem}else{"$($G.RutaGD)/$($lstGD.SelectedItem)"}
        LoadGD $n}})
$lstGD.add_DoubleClick({$btnGDIn.PerformClick()})
$btnGDUp.add_Click({if($G.PilaGD.Count -gt 0){LoadGD($G.PilaGD.Pop())}else{LoadGD ""}})
$btnGDSel.add_Click({
    if($G.DriveID -eq ""){
        SetSt $lblDestSel "Selecciona primero una unidad compartida." "warn"; return}
    $G.CarpDest=$G.RutaGD
    $d=if($G.RutaGD -eq ""){"/"}else{"/$($G.RutaGD)"}
    SetSt $lblDestSel "[OK] $($G.DriveNom)$d" "ok"; CheckReady})

$btnGDRoot.add_Click({
    if($G.DriveID -eq ""){
        SetSt $lblDestSel "Carga primero las unidades y selecciona una." "warn"; return}
    $G.CarpDest=""; $G.RutaGD=""; $lblRutaGD.Text="  /"
    SetSt $lblDestSel "[OK] $($G.DriveNom)/  (raiz de la unidad)" "ok"; CheckReady})

# Lee todas las lineas de un archivo que puede estar abierto para escritura por otro proceso (rclone)
function ReadLogShared { param($path)
    try{
        $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        $lines = New-Object System.Collections.Generic.List[string]
        while(-not $sr.EndOfStream){ $lines.Add($sr.ReadLine()) }
        $sr.Dispose(); $fs.Dispose()
        return $lines.ToArray()
    }catch{ return @() } }

function UpdStats { param($line)
    # Formato de --stats-one-line en rclone 1.73:
    #   112.987 MiB / 62.340 GiB, 0%, 1.891 MiB/s, ETA 9h21m44s (xfr#62/10118)
    # Archivos transferidos / total: xfr#<done>/<total>
    if($line -match 'xfr#(\d+)/(\d+)'){
        $stLabels[0].Text="$($matches[1]) / $($matches[2])"
    }
    # Velocidad
    if($line -match '([\d.]+\s*[KMGT]?i?B/s)'){
        $stLabels[1].Text=$matches[1]
    }
    # ETA
    if($line -match 'ETA\s+(\S+?)(?:\s*\(|$)'){
        $e=$matches[1]; if($e -eq "-"){$e="..."}
        $stLabels[2].Text=$e
    }
    # Porcentaje / progreso
    if($line -match '([\d.]+\s*[KMGT]?i?B)\s*/\s*([\d.]+\s*[KMGT]?i?B),\s*(\d+)%'){
        $stLabels[3].Text="$($matches[3])%  ($($matches[1]))"
    }
    # Errores (si aparecen)
    if($line -match ',\s*(\d+)\s+error'){
        $n=[int]$matches[1]
        $stLabels[4].Text="$n"
        $stLabels[4].ForeColor=if($n -gt 0){$RD}else{$GR}
    }
    # Completado (cuando termina)
    if($line -match 'Transferred:\s+([\d.]+\s*[KMGT]?i?B)\s*/\s*([\d.]+\s*[KMGT]?i?B)'){
        $stLabels[3].Text=$matches[1]
    } }

$btnGo.add_Click({
    $G.RemoteDB=$txtNDB.Text.Trim(); $G.RemoteGD=$txtNGD.Text.Trim()
    $sim=$chkSim.Checked; $wrap=$chkWrap.Checked
    $banda=$txtBanda.Text.Trim(); $tr=[int]$numT.Value; $ch=[int]($tr*3)

    # Construir rutas origen y destino tal como las vera rclone
    $origPath=$G.CarpOrig
    $destPath=$G.CarpDest
    # Si "Crear subcarpeta con nombre del origen" esta activo,
    # anadimos el nombre de la carpeta origen al destino.
    if($wrap){
        $srcName=if($origPath -eq ""){$G.RemoteDB}else{($origPath -split "/")[-1]}
        if($srcName -ne ""){
            $destPath=if($destPath -eq ""){$srcName}else{"$destPath/$srcName"}}}
    $orig="$($G.RemoteDB):$origPath"
    $dest="$($G.RemoteGD):$destPath"

    # -- Dialogo de previsualizacion --
    $origVis=if($origPath -eq ""){"(raiz de $($G.RemoteDB))"}else{"/$origPath"}
    $destVis="$($G.DriveNom)/"+$destPath
    $msg =  "Se va a $(if($sim){'SIMULAR '}else{''})la siguiente migracion:`r`n`r`n"
    $msg += "ORIGEN (Dropbox):`r`n  $origVis`r`n`r`n"
    $msg += "DESTINO (Shared Drive):`r`n  $destVis`r`n`r`n"
    if($wrap){
        $msg += "COMPORTAMIENTO: se creara la carpeta del origen dentro del destino.`r`n"
        $msg += "  Ejemplo: los archivos acabaran en $destVis/...`r`n`r`n"
    } else {
        $msg += "COMPORTAMIENTO: el contenido del origen se volcara DIRECTAMENTE en el destino.`r`n"
        $msg += "  Ejemplo: archivo 'foo.jpg' del origen ira a $destVis/foo.jpg`r`n`r`n"
    }
    $msg += "Transferencias paralelas: $tr  |  Banda: $(if($banda -eq '0' -or $banda -eq ''){'libre'}else{$banda})`r`n"
    if($sim){$msg += "`r`nModo SIMULACION: no se mueve nada, solo se muestra lo que haria.`r`n"}
    $msg += "`r`nContinuar?"
    $titleDlg=if($sim){"Confirmar SIMULACION"}else{"Confirmar MIGRACION"}
    $r=[Windows.Forms.MessageBox]::Show($msg,$titleDlg,"OKCancel",$(if($sim){"Information"}else{"Warning"}))
    if($r -ne "OK"){return}

    $lf=Join-Path $G.LogDir "mig_$(Get-Date -Format 'HHmmss').log"

    foreach($sl in $stLabels){$sl.Text="-"}
    $stLabels[4].Text="0"; $stLabels[4].ForeColor=$GR
    $progMig.MarqueeAnimationSpeed=0; $rtbLog.Clear()

    LogLine "========================================" $OR
    LogLine "  MIGRACION$(if($sim){' [SIMULACION]'}else{''})" $OR
    LogLine "  Origen:  $orig"
    LogLine "  Destino: $dest  ($($G.DriveNom))"
    LogLine "  Subcarpeta: $(if($wrap){'SI'}else{'NO'})"
    LogLine "  Transfers: $tr | Checkers: $ch | Banda: $banda"
    LogLine "========================================" $OR

    # Flags optimizados para migraciones con MUCHOS archivos pequeños:
    # - tpslimit 30 (maximo que Dropbox aguanta sin 429 sostenido)
    # - --size-only: comparar por tamano, no por modtime -> menos llamadas metadata
    # - --no-traverse: no lista dest, solo crea archivos nuevos
    # - --no-update-modtime: no llama SetModTime tras cada subida
    # - chunks 64M, buffer 32M para archivos grandes cuando los hay
    $al=@("sync",$orig,$dest,
        "--drive-team-drive",$G.DriveID,"--transfers",$tr,"--checkers",$ch,
        "--fast-list","--retries","10","--low-level-retries","20","--retries-sleep","5s",
        "--ignore-errors",
        "--size-only","--no-traverse","--no-update-modtime",
        "--drive-chunk-size","64M","--drive-upload-cutoff","64M",
        "--drive-pacer-min-sleep","10ms","--drive-pacer-burst","100",
        "--drive-acknowledge-abuse",
        "--buffer-size","32M",
        "--tpslimit","30","--tpslimit-burst","60",
        "--log-file",$lf,"--log-level","INFO",
        "--stats","5s","--stats-one-line","--use-mmap")
    # Namespace del equipo Dropbox: rclone acepta --dropbox-root-namespace <id_numerico>
    if($G.DBNamespace -eq "team_space" -and $G.DBNamespaceId){
        $al+="--dropbox-root-namespace"; $al+=$G.DBNamespaceId
    }
    if($banda -ne "0" -and $banda -ne ""){$al+="--bwlimit";$al+=$banda}
    if($sim){$al+="--dry-run"}

    $psi=New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName=$G.RcPath; $psi.Arguments=$al -join " "
    $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
    # NO redirigir stdout/stderr con BeginOutputReadLine/BeginErrorReadLine:
    # esos eventos disparan en hilos del ThreadPool y PowerShell no puede ejecutar
    # script blocks en ellos (PSInvalidOperation: GetContextFromTLS -> crash fatal).
    # Todo el output de rclone ya va al log file via --log-file; lo taileamos desde el timer.

    $G.Proc=New-Object System.Diagnostics.Process; $G.Proc.StartInfo=$psi
    $G.Proc.Start()|Out-Null

    $progMig.MarqueeAnimationSpeed=20
    SetSt $lblMigSt $(if($sim){"Simulando..."}else{"Migrando..."}) "warn"
    $btnGo.Enabled=$false; $btnStop.Enabled=$true

    # Empaquetar estado en hashtable para que sea accesible desde el closure del timer
    # (las variables locales $t, $lf, $migSt se pierden si no se capturan explicitamente)
    $migSt=@{Lines=0; t=$null; lf=$lf}
    $t=New-Object Windows.Forms.Timer; $t.Interval=2000
    $migSt.t=$t
    $t.add_Tick({
        try{
            $curLf=$migSt.lf
            # Tailear log file: leer solo las lineas nuevas desde el ultimo tick
            if(Test-Path $curLf){
                try{
                    $all=ReadLogShared $curLf
                    if($all.Count -gt $migSt.Lines){
                        $nuevas=$all[$migSt.Lines..($all.Count-1)]
                        $migSt.Lines=$all.Count
                        foreach($ln in $nuevas){LogLine $ln; UpdStats $ln}
                    }
                }catch{}  # el archivo puede estar bloqueado por rclone momentaneamente
            }
            if($G.Proc -ne $null -and $G.Proc.HasExited){
                $migSt.t.Stop(); $progMig.MarqueeAnimationSpeed=0
                # Leer lineas finales pendientes
                if(Test-Path $curLf){
                    try{
                        $all=ReadLogShared $curLf
                        if($all.Count -gt $migSt.Lines){
                            foreach($ln in $all[$migSt.Lines..($all.Count-1)]){LogLine $ln; UpdStats $ln}
                        }
                    }catch{}
                }
                $code=$G.Proc.ExitCode
                if($code -eq 0){
                    LogLine "[COMPLETADO SIN ERRORES]" $GR
                    SetSt $lblMigSt "[OK] Completado" "ok"
                    $stLabels[1].Text="---"; $stLabels[2].Text="Listo"}
                else{LogLine "[Finalizado con codigo $code]" $AM; SetSt $lblMigSt "Avisos (cod.$code)" "warn"}
                LogLine "Log: $curLf" $MT
                $btnGo.Enabled=$true; $btnStop.Enabled=$false}
        }catch{
            try{$migSt.t.Stop()}catch{}
            $progMig.MarqueeAnimationSpeed=0
            LogLine "Error en el monitor de migracion: $_" $RD
            SetSt $lblMigSt "Error interno." "err"
            $btnGo.Enabled=$true; $btnStop.Enabled=$false
        }}.GetNewClosure())
    $t.Start()})

$btnStop.add_Click({
    if($G.Proc -ne $null -and -not $G.Proc.HasExited){
        $G.Proc.Kill(); LogLine "[Detenido por el usuario]" $AM
        SetSt $lblMigSt "Detenido." "warn"
        $progMig.MarqueeAnimationSpeed=0
        $btnGo.Enabled=$true; $btnStop.Enabled=$false}})

$btnLogs.add_Click({
    if(Test-Path $G.LogDir){Start-Process explorer.exe $G.LogDir}
    else{[Windows.Forms.MessageBox]::Show("Aun no hay logs.")|Out-Null}})

# =============================================================================
# ARRANQUE
# =============================================================================
function LayoutP2 {
    $w=$form.ClientSize.Width; $h=$form.ClientSize.Height
    $nav.Width=$w; $wrap.Width=$w; $wrap.Height=$h-50
    $nw=[Math]::Max($w-30,1200)                     # ancho util de la pagina
    $half=[int](($nw-20)/2)                          # ancho de cada panel (2 columnas iguales)
    # Paneles superiores (posiciones fijas)
    $c2orig.Left=15; $c2orig.Width=$half
    $c2dest.Left=15+$half+10; $c2dest.Width=$half
    # Listas y controles internos — ajustar al ancho del panel
    $inW=$half-28
    $lblRuta.Width=$inW;   $lstDB.Width=$inW
    $lblRutaGD.Width=$inW; $lstGD.Width=$inW; $lstUD.Width=$inW; $sep.Width=$inW
    $lblOrigSel.Width=$inW; $lblDestSel.Width=$inW
    # Botones del panel Dropbox: Subir/Entrar fijos a la izquierda, Usar carpeta se estira, Recargar a la derecha
    $btnSel.Width=$inW-226-152
    $btnRefDB.Left=$inW-138
    # Mismo esquema para el panel Drive
    $btnGDSel.Width=$inW-226-152
    $btnGDRoot.Left=$inW-138
    # Filas inferiores full-width
    $c2opc.Width=$nw; $barAct.Width=$nw; $c2st.Width=$nw
    $progMig.Width=$nw; $rtbLog.Width=$nw
    # Stats cards (5 columnas iguales)
    $sw=[int](($nw-20)/5)
    for($i=0;$i -lt 5;$i++){
        $card=$c2st.Controls[$i]
        $card.Left=$i*$sw+10; $card.Width=$sw-10
        $card.Controls[0].Width=$sw-22; $card.Controls[1].Width=$sw-22}
}
$form.add_Resize({LayoutP2})

$form.add_FormClosing({
    if($G.Proc -ne $null -and -not $G.Proc.HasExited){
        $r=[Windows.Forms.MessageBox]::Show("Migracion en curso. Salir y detenerla?","Confirmar","YesNo","Warning")
        if($r -eq "No"){$_.Cancel=$true;return}; $G.Proc.Kill()}})

$form.add_Shown({
    LayoutP2  # fuerza el layout inicial de la pagina 2
    ChkRC|Out-Null
    if(LoadEnv){
        $rem=GetRemotes; $db=$rem -contains $G.RemoteDB; $gd=$rem -contains $G.RemoteGD
        if($db -and $gd){
            SetSt $lblSDB "[OK] Sesion guardada" "ok"; SetSt $lblSGD "[OK] Sesion guardada" "ok"
            SetSt $lblVer "OK - Cuentas cargadas de sesion anterior." "ok"
            $btnGoP2.Enabled=$true; GoPage 2}
        elseif($db -or $gd){GoPage 1}
        else{GoPage 1}}})

[Windows.Forms.Application]::Run($form)
