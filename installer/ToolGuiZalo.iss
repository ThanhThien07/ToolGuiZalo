; ToolGuiZalo Pro V2 - Inno Setup Installer Script (Roadmap Mục 14)
; Lưu dữ liệu người dùng bên ngoài Program Files ({localappdata}\ToolGuiZalo)
; KHÔNG đóng gói database khách hàng, hub secrets, uploads hay user_data.

#define MyAppName "ToolGuiZalo Pro V2"
#define MyAppVersion "2.0.0"
#define MyAppExeName "ToolGuiZalo_Launcher.cmd"

[Setup]
AppId={{8F2A91B4-4E6D-4D7E-A742-6D1A28B09200}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\ToolGuiZaloProV2
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ToolGuiZalo_V2_Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Tạo biểu tượng trên Desktop"; GroupDescription: "Tác vụ bổ sung:"

[Files]
Source: "..\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\start.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\.env.example"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{localappdata}\ToolGuiZalo\data"
Name: "{localappdata}\ToolGuiZalo\backups"
Name: "{localappdata}\ToolGuiZalo\uploads\images"
Name: "{localappdata}\ToolGuiZalo\user_data"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\start.bat"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\start.bat"; Tasks: desktopicon

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := True;
  if MsgBox('Bạn có muốn GIỮ LẠI dữ liệu khách hàng & phiên làm việc tại %LOCALAPPDATA%\ToolGuiZalo không?' + #13#10 + 'Chọn Yes để giữ dữ liệu, hoặc No để xóa sạch hoàn toàn.', mbConfirmation, MB_YESNO) = IDNO then
  begin
    DelTree(ExpandConstant('{localappdata}\ToolGuiZalo'), True, True, True);
  end;
end;
