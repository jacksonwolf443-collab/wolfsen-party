# 派对软件 - 狼森

给线下派对主持人用的 Windows 桌面工具。可以登记玩家和照片、现场组队、玩活动、记分、投屏和颁奖。

## 下载和开始玩

到仓库的 **Releases** 下载 `WolfsenParty-1.2.0-Windows-x64.exe`，双击运行。首次打开是空白派对。在「玩家档案」新增玩家并签到，再从左栏选择活动。按 `F11` 全屏，舞台模式按 `Esc` 返回。公开版当前没有代码签名，Windows 可能提示未知发布者。

玩家资料、照片和进度保存在 `%APPDATA%\WolfsenParty\data`。「AI 与本地存档」可以导出完整 `.jungle` 备份，或在另一台电脑恢复。分享软件时发送 EXE 或仓库链接。备份内含本场的玩家资料和照片。

## 手机扫码领任务

在「客官,YOU HAPPY？」打开「手机扫码领任务」。现场手机和主持电脑在同一 Wi-Fi 时，点击「开启局域网」。手机使用流量或不同网络时，按 [手机任务服务器部署说明](server/README.md) 搭建自己的 HTTPS 服务器，再导入自己的连接文件或填写连接信息。手机页选择昵称即可领取任务，二维码只发给本场玩家。

## 可选的云端 AI

首次启动可离线随机或手动组队、用现场猜画配合主持人判分、完成其他普通活动。启用云端 AI 后，兴趣匹配、作画猜测、合照等功能会把相应活动资料发给你自己的阿里云百炼账号，产生的费用记入该账号。调用照片功能前请征得玩家同意。

有自己百炼账号的主持人可以用 PowerShell 临时设置进程环境变量再启动程序。把示例文件名替换为自己的 EXE 路径。

```powershell
$env:WOLFSEN_DASHSCOPE_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host '百炼凭证' -AsSecureString)).Password
try { Start-Process -FilePath '.\WolfsenParty-1.2.0-Windows-x64.exe' }
finally { Remove-Item Env:WOLFSEN_DASHSCOPE_API_KEY }
```

先退出已有软件窗口再运行上述命令。程序界面只提供地域、模型和业务空间等设置。凭证由启动进程提供，程序的本地存档和导出备份不写入它。

## 从源码运行、测试和构建

准备 Node.js 24 和 pnpm 11.25.0。在项目根目录运行以下命令。

```sh
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm build
pnpm start
```

运行测试还需要 `Python 3` 和它的 `cryptography` 包（生成临时 TLS 测试证书）。可用 `PARTY_TEST_PYTHON` 指定 Python 路径，然后运行 `pnpm test`。

在 Windows x64 上运行 `pnpm dist:win`，便携 EXE 会生成在 `release/`。源码仓库存放程序、测试和部署说明，EXE 放在 GitHub Release 的 Assets。

## 许可

应用源码使用 [MIT](LICENSE)。随附的第三方模型及运行库使用各自许可，见 [第三方许可和来源](assets/THIRD-PARTY-NOTICES.txt)。
