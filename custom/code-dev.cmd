@echo off
rem custom/code-dev.cmd
rem
rem Dev launcher for this fork. Runs the upstream scripts\code.bat unchanged, but tells the
rem extension scanner to skip the built-in AI extensions, so the dev window matches the
rem shipped product. Uses VSCODE_SKIP_BUILTIN_EXTENSIONS, which filters built-in extensions
rem by id in src/vs/platform/extensionManagement/common/extensionsScannerService.ts - no
rem upstream file has to be edited for this.
rem
rem Usage:  custom\code-dev.cmd [any args you would pass to scripts\code.bat]
setlocal

set VSCODE_SKIP_BUILTIN_EXTENSIONS=GitHub.copilot-chat,GitHub.copilot

call "%~dp0..\scripts\code.bat" %*

endlocal
