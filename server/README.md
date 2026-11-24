# 自建手机任务服务器

现场手机和主持电脑能连同一 Wi-Fi 时，可直接用软件的「开启局域网」。需要通过不同网络扫码时，部署下面的 HTTPS 中继。主持电脑在线并打开手机入口后，中继才提供任务。

## 1. 生成自己的连接文件

准备有公网域名的 Linux 主机、Python 3 和支持 HTTPS 的反向代理。将域名的 DNS 记录指向主机，开放代理所需的 TCP 80 和 443。下文以 `party.example.com` 为例，请全部换成自己的域名。`18742` 只用于服务器本机。

在源码根目录执行以下命令。`--output` 指向尚不存在的目录。

```sh
python3 server/configure.py https://party.example.com --output ~/wolfsen-party-config
python3 server/relay.py --config ~/wolfsen-party-config/relay.json
```

`relay.json` 留在服务器上。把 `connection.partyserver` 通过私密方式复制到自己的主持电脑。两个文件含有同一个连接凭证，只交给本场主持人。

## 2. 设置 HTTPS 反向代理

如果使用 Caddy，在 Caddyfile 里添加以下站点并重载。Caddy 可以为公开域名签发、续期 HTTPS 证书。[Caddy 自动 HTTPS 说明](https://caddyserver.com/docs/automatic-https)

```caddyfile
party.example.com {
    reverse_proxy 127.0.0.1:18742
}
```

将请求原样转给中继，包括 `Host` 请求头。部署后用 `curl https://party.example.com/health` 检查，应返回 `wolfsen-party-relay-v1`。桌面端尚未连接时 `connected` 为 `false`。

## 3. 在主持电脑连接

打开「客官,YOU HAPPY？」→「手机扫码领任务」→「自建公网服务器」，导入 `connection.partyserver`。也可以手动填写该文件的 `url` 和 `token`。启动后页面显示「自建服务器已连接」和二维码。用手机切到流量现场试扫一次，再把二维码发给本场玩家。

每个中继同一时间连接一台主持电脑。换场时点「关闭手机入口」，重新开启会生成新的二维码。中继转发玩家昵称、任务和验收请求，玩家照片与完整存档保留在主持电脑。

## 4. 让服务器开机自启

先用上述命令测试通过，再让一个专用普通用户运行中继。以下是 systemd 服务模板。部署时把 `User` 和两个文件路径改成自己的，确保运行用户读得了配置文件。

```ini
[Unit]
Description=Wolfsen Party phone relay
After=network.target

[Service]
User=wolfsen-party
ExecStart=/usr/bin/python3 /opt/wolfsen-party/server/relay.py --config /etc/wolfsen-party/relay.json
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

保存为 `/etc/systemd/system/wolfsen-party.service`，停止前面手动运行的中继，然后执行 `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now wolfsen-party`。
