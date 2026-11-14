Option Explicit
Dim shell, fso, dir, log, code, started, elapsed, text

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
log = dir & "\launcher.log"

' O Node.js tem de estar instalado
If shell.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "O Node.js não está instalado." & vbCrLf & "Instala-o em https://nodejs.org e volta a abrir o StreamNexus.", 48, "StreamNexus"
  WScript.Quit 1
End If

' Primeira execução: instala as dependências (mostra uma janela só nesse momento)
If Not fso.FolderExists(dir & "\node_modules") Then
  If shell.Run("cmd /c npm install", 1, True) <> 0 Then
    MsgBox "Falhou a instalação das dependências.", 48, "StreamNexus"
    WScript.Quit 1
  End If
End If

' Arranca sem janela de consola; fechar a app encerra também o servidor
started = Timer
code = shell.Run("cmd /c npm run desktop > """ & log & """ 2>&1", 0, True)
elapsed = Timer - started

' Se terminou logo no arranque, algo correu mal: mostra o fim do registo
If elapsed < 25 Then
  text = ""
  If fso.FileExists(log) Then
    text = fso.OpenTextFile(log, 1).ReadAll
    If Len(text) > 700 Then text = Right(text, 700)
  End If
  MsgBox "O StreamNexus não conseguiu arrancar." & vbCrLf & vbCrLf & text, 48, "StreamNexus"
End If
