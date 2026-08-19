Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
venvPythonw = root & "\.venv\Scripts\pythonw.exe"
venvPython = root & "\.venv\Scripts\python.exe"
If fso.FileExists(venvPythonw) Then
  pythonExe = """" & venvPythonw & """"
ElseIf fso.FileExists(venvPython) Then
  pythonExe = """" & venvPython & """"
Else
  pythonExe = "pythonw.exe"
End If
shell.Run pythonExe & " """ & root & "\start_server.py"" --no-wait", 0, False
