Option Explicit

Dim shell, fso, appDir, npmCommand, electronExe, mainBuild, appExe, portableExe, logPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir

npmCommand = GetNpmCommand()
electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")
mainBuild = fso.BuildPath(appDir, "out\main\index.js")
appExe = fso.BuildPath(appDir, "dist\win-unpacked\ClearSkin Hub.exe")
portableExe = fso.BuildPath(appDir, "dist\ClearSkin Hub 0.1.0.exe")
logPath = fso.BuildPath(appDir, "launch-error.log")

If CanRunNpm() Then
  RunHidden npmCommand & " run build"
End If

If fso.FileExists(electronExe) And fso.FileExists(mainBuild) Then
  LaunchVisible Quote(electronExe) & " " & Quote(appDir)
  WScript.Quit 0
End If

If fso.FileExists(appExe) Then
  LaunchVisible Quote(appExe)
  WScript.Quit 0
End If

If fso.FileExists(portableExe) Then
  LaunchVisible Quote(portableExe)
  WScript.Quit 0
End If

If CanRunNpm() Then
  If RunHidden(npmCommand & " run package") = 0 Then
    If fso.FileExists(appExe) Then
      LaunchVisible Quote(appExe)
      WScript.Quit 0
    End If

    If fso.FileExists(portableExe) Then
      LaunchVisible Quote(portableExe)
      WScript.Quit 0
    End If
  End If
End If

WriteLog "Could not find or build a runnable ClearSkin Hub executable."
MsgBox "Could not find or build a runnable ClearSkin Hub executable. Check launch-error.log in the app folder.", vbExclamation, "ClearSkin Hub"
WScript.Quit 1

Function GetNpmCommand()
  Dim programFilesNpm

  programFilesNpm = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\npm.cmd"
  If fso.FileExists(programFilesNpm) Then
    GetNpmCommand = Quote(programFilesNpm)
  Else
    GetNpmCommand = "npm.cmd"
  End If
End Function

Function CanRunNpm()
  CanRunNpm = fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\npm.cmd")
End Function

Function RunHidden(command)
  RunHidden = shell.Run("%ComSpec% /d /s /c " & Quote(command), 0, True)
  If RunHidden <> 0 Then
    WriteLog "Command failed with exit code " & RunHidden & ": " & command
  End If
End Function

Sub LaunchVisible(command)
  shell.Run command, 1, False
End Sub

Function Quote(value)
  Quote = """" & value & """"
End Function

Sub WriteLog(message)
  Dim logFile
  Set logFile = fso.OpenTextFile(logPath, 8, True)
  logFile.WriteLine Now & " - " & message
  logFile.Close
End Sub
